import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { Sequelize } from 'sequelize'
import BranchModel from '../Models/Branch'
import CityModel from '../Models/City'
import WpClientRecord from '../Models/WpClientRecord'
import ChatBotMessageRecord from '../Models/ChatBotMessageRecord'
import RideFeeSettingRecord from '../Models/RideFeeSettingRecord'
import RideFeeDynamicMultiplierRecord from '../Models/RideFeeDynamicMultiplierRecord'
import { WpClient } from '../Interfaces/WpClient'
import { ChatBotMessage } from '../Types/ChatBotMessage'
import { MessagesEnum } from '../Services/chatBot/MessagesEnum'
import { Branch } from '../Interfaces/Branch'
import { City } from '../Interfaces/City'
import { DynamicMultiplier } from '../Types/DynamicMultiplier'
import { RideFeeInterface } from '../Types/RideFeeInterface'

dayjs.extend(utc)
dayjs.extend(timezone)

class MasterDataRepository {
  constructor(private sequelize: Sequelize) { }

  async listWpClients(): Promise<WpClient[]> {
    const clients = await WpClientRecord.findAll({
      order: [['id', 'ASC']],
    })

    return clients.map((client) => this.mapWpClient(client))
  }

  async findWpClient(id: string): Promise<WpClient | null> {
    const client = await WpClientRecord.findByPk(id)
    return client ? this.mapWpClient(client) : null
  }

  async storeWpClient(payload: WpClient): Promise<WpClient> {
    const [client] = await WpClientRecord.upsert(payload, { returning: true })
    return this.mapWpClient(client)
  }

  async updateWpClient(id: string, payload: Partial<WpClient>): Promise<WpClient | null> {
    const existing = await WpClientRecord.findByPk(id)
    if (!existing) return null

    Object.assign(existing, payload)
    await existing.save()
    return this.mapWpClient(existing)
  }

  async deleteWpClient(id: string): Promise<boolean> {
    return (await WpClientRecord.destroy({ where: { id } })) > 0
  }

  async listChatBotMessages(): Promise<ChatBotMessage[]> {
    const messages = await ChatBotMessageRecord.findAll({
      order: [['id', 'ASC']],
    })

    return messages.map((message) => this.mapChatBotMessage(message))
  }

  async getChatBotMessagesMap(): Promise<Map<MessagesEnum, ChatBotMessage>> {
    const messages = await this.listChatBotMessages()
    const mapped = new Map<MessagesEnum, ChatBotMessage>()

    messages.forEach((message) => {
      const enumValue = Object.values(MessagesEnum).find((value) => value === message.id)
      if (enumValue) {
        mapped.set(enumValue as MessagesEnum, message)
      }
    })

    return mapped
  }

  async updateChatBotMessage(
    id: string,
    payload: Omit<ChatBotMessage, 'id'> & { id?: string }
  ): Promise<ChatBotMessage> {
    const [message] = await ChatBotMessageRecord.upsert(
      {
        ...payload,
        id,
      },
      { returning: true }
    )

    return this.mapChatBotMessage(message)
  }

  async getRideFees(): Promise<RideFeeInterface> {
    const [settings] = await RideFeeSettingRecord.findOrCreate({
      where: { id: 'default' },
      defaults: {
        id: 'default',
      },
    })

    const multipliers = await RideFeeDynamicMultiplierRecord.findAll({
      where: { setting_id: settings.id },
      order: [['position', 'ASC'], ['id', 'ASC']],
    })

    return {
      ...(settings.get({ plain: true }) as any),
      dynamic_multipliers: multipliers.map((multiplier) => this.mapDynamicMultiplier(multiplier)),
    } as RideFeeInterface
  }

  async updateRideFees(payload: RideFeeInterface): Promise<RideFeeInterface> {
    await this.sequelize.transaction(async (transaction) => {
      await RideFeeSettingRecord.upsert(
        {
          ...payload,
          id: 'default',
        },
        { transaction }
      )

      await RideFeeDynamicMultiplierRecord.destroy({
        where: { setting_id: 'default' },
        transaction,
      })

      const multipliers = payload.dynamic_multipliers ?? []
      for (const [index, multiplier] of multipliers.entries()) {
        await RideFeeDynamicMultiplierRecord.create(
          {
            setting_id: 'default',
            name: multiplier.name,
            multiplier: multiplier.multiplier,
            start_time: multiplier.timeRanges.start,
            end_time: multiplier.timeRanges.end,
            position: index,
          },
          { transaction }
        )
      }
    })

    return this.getRideFees()
  }

  async buildPricingSnapshot(at: dayjs.Dayjs = dayjs().tz('America/Bogota')): Promise<RideFeeInterface> {
    const settings = await this.getRideFees()
    let minimum = settings.fees_min_day
    let multiplier = 1
    const isDay = at.hour() >= 6 && at.hour() < 18
    const isNight = !isDay
    const isSunday = at.day() === 0

    if (isSunday) {
      minimum = isDay ? settings.fees_min_festive_day : settings.fees_min_festive_nigth
      multiplier = isDay ? settings.fees_DxF : settings.fees_night_DxF
    } else {
      minimum = isDay ? settings.fees_min_day : settings.fees_min_nigth
      multiplier = isDay ? 1 : settings.fees_night
    }

    for (const element of settings.dynamic_multipliers ?? []) {
      const today = at.format('YYYY-MM-DD')
      const start = dayjs.tz(
        `${today} ${element.timeRanges.start}`,
        'YYYY-MM-DD HH:mm',
        'America/Bogota'
      )
      const end = dayjs.tz(
        `${today} ${element.timeRanges.end}`,
        'YYYY-MM-DD HH:mm',
        'America/Bogota'
      )

      if (at.isAfter(start) && at.isBefore(end)) {
        multiplier = element.multiplier
      }
    }

    return {
      ...settings,
      fees_minimum: minimum,
      fee_multiplier: multiplier,
    }
  }

  async getBranches(): Promise<Branch[]> {
    const branches = await BranchModel.findAll({
      include: [
        {
          model: CityModel,
          as: 'cities',
        },
      ],
      order: [
        ['country', 'ASC'],
        [{ model: CityModel, as: 'cities' }, 'name', 'ASC'],
      ],
    })

    return branches.map((branch) => {
      const branchPlain = branch.get({ plain: true }) as any
      return {
        id: branchPlain.id,
        calling_code: branchPlain.callingCode,
        country: branchPlain.country,
        currency_code: branchPlain.currencyCode,
        cities: (branchPlain.cities ?? []).map((city: any) => this.mapCity(city)),
      }
    })
  }

  async getCity(branchId: string, cityId: string): Promise<City | null> {
    const city = await CityModel.findOne({
      where: {
        id: cityId,
        branchId,
      },
    })

    if (!city) return null
    return this.mapCity(city.get({ plain: true }))
  }

  async updateCityPercentage(
    branchId: string,
    cityId: string,
    percentage: number
  ): Promise<City | null> {
    const city = await CityModel.findOne({
      where: {
        id: cityId,
        branchId,
      },
    })

    if (!city) return null

    city.percentage = percentage
    await city.save()
    return this.mapCity(city.get({ plain: true }))
  }

  async updateCityPolygon(
    branchId: string,
    cityId: string,
    polygon: Array<{ lat: number; lng: number }>
  ): Promise<City | null> {
    const city = await CityModel.findOne({
      where: {
        id: cityId,
        branchId,
      },
    })

    if (!city) return null

    city.polygon = {
      type: 'Polygon',
      coordinates: [polygon.map((point) => [point.lng, point.lat])],
    }
    await city.save()
    return this.mapCity(city.get({ plain: true }))
  }

  private mapWpClient(client: WpClientRecord): WpClient {
    const plain = client.get({ plain: true }) as any
    return {
      id: plain.id,
      alias: plain.alias,
      wpNotifications: plain.wpNotifications,
      full: plain.full,
      chatBot: plain.chatBot,
      assistant: plain.assistant,
      service: plain.service,
    }
  }

  private mapChatBotMessage(message: ChatBotMessageRecord): ChatBotMessage {
    const plain = message.get({ plain: true }) as any
    return {
      id: plain.id,
      name: plain.name,
      description: plain.description,
      message: plain.message,
      enabled: plain.enabled,
      interactive: plain.interactive ?? null,
    }
  }

  private mapDynamicMultiplier(multiplier: RideFeeDynamicMultiplierRecord): DynamicMultiplier {
    const plain = multiplier.get({ plain: true }) as any
    return {
      name: plain.name,
      multiplier: plain.multiplier,
      timeRanges: {
        start: plain.start_time,
        end: plain.end_time,
      },
    }
  }

  private mapCity(city: any): City {
    const centerCoordinates = city.center?.coordinates ?? [0, 0]
    const polygonCoordinates = city.polygon?.coordinates?.[0] ?? []

    return {
      id: city.id,
      branchId: city.branchId ?? city.branch_id ?? '',
      name: city.name,
      percentage: Number(city.percentage ?? 0),
      location: {
        lat: centerCoordinates[1] ?? 0,
        lng: centerCoordinates[0] ?? 0,
      },
      polygon: polygonCoordinates.map((coordinate: number[]) => ({
        lat: coordinate[1],
        lng: coordinate[0],
      })),
    }
  }
}

export default MasterDataRepository
