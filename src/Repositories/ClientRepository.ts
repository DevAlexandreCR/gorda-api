import { Op, Sequelize } from 'sequelize'
import * as Sentry from '@sentry/node'
import config from '../../config'
import SequelizeClient from '../Models/Client'
import { ClientInterface } from '../Interfaces/ClientInterface'
import { WpContactInterface } from '../Services/whatsapp/interfaces/WpContactInterface'

interface StoreClientInput {
  id?: string
  name: string
  phone: string
  photoUrl?: string
}

class ClientRepository {
  constructor(private sequelize: Sequelize) {}

  async index(search?: string): Promise<ClientInterface[]> {
    const normalizedSearch = search?.trim()
    const where = normalizedSearch
      ? {
          [Op.or]: [
            { name: { [Op.iLike]: `%${normalizedSearch}%` } },
            { phone: { [Op.iLike]: `%${normalizedSearch}%` } },
            { id: { [Op.iLike]: `%${normalizedSearch}%` } },
          ],
        }
      : undefined

    const clients = await SequelizeClient.findAll({
      where,
      order: [['updatedAt', 'DESC']],
    })

    return clients.map((client) => this.mapClient(client))
  }

  async findById(id: string): Promise<ClientInterface | null> {
    const clientId = this.normalizeId(id)
    if (!clientId) return null

    const client = await SequelizeClient.findByPk(clientId)
    return client ? this.mapClient(client) : null
  }

  async findByPhone(phone: string): Promise<ClientInterface | null> {
    const normalizedPhone = this.normalizePhone(phone)
    if (!normalizedPhone) return null

    const client = await SequelizeClient.findOne({ where: { phone: normalizedPhone } })
    return client ? this.mapClient(client) : null
  }

  async store(clientData: StoreClientInput): Promise<ClientInterface> {
    const payload = this.buildPayload(clientData)
    const [client] = await SequelizeClient.upsert(payload, { returning: true })
    return this.mapClient(client)
  }

  async create(contact: WpContactInterface): Promise<ClientInterface> {
    const photoUrl = await this.resolvePhotoUrl(contact)
    return this.store({
      id: contact.id,
      name: contact.pushname ?? 'Usuario',
      phone: contact.number?.toString() ?? '',
      photoUrl,
    })
  }

  private buildPayload(data: StoreClientInput): StoreClientInput & { id: string; phone: string } {
    const normalizedId = this.normalizeId(data.id ?? data.phone)
    if (!normalizedId) throw new Error('Client ID is required')

    const normalizedPhone = this.normalizePhone(data.phone)
    if (!normalizedPhone) throw new Error('Client phone is required')

    return {
      id: normalizedId,
      name: data.name?.trim() || 'Usuario',
      phone: normalizedPhone,
      photoUrl: data.photoUrl?.trim() || config.DEFAULT_CLIENT_PHOTO_URL,
    }
  }

  private normalizeId(rawId?: string): string {
    if (!rawId) return ''
    const digits = rawId.toString().replace(/[^\d]/g, '')
    return digits
  }

  private normalizePhone(rawPhone?: string): string {
    if (!rawPhone) return ''
    const trimmed = rawPhone.toString().trim()
    if (!trimmed) return ''

    const digits = trimmed.replace(/[^\d]/g, '')
    if (!digits) return ''

    return `+${digits}`
  }

  private async resolvePhotoUrl(contact: WpContactInterface): Promise<string> {
    try {
      const photoUrl = await contact.getProfilePicUrl()
      return photoUrl || config.DEFAULT_CLIENT_PHOTO_URL
    } catch (error) {
      Sentry.captureException(error)
      return config.DEFAULT_CLIENT_PHOTO_URL
    }
  }

  private mapClient(client: SequelizeClient): ClientInterface {
    const plain = client.get({ plain: true }) as ClientInterface
    return {
      ...plain,
      photoUrl: plain.photoUrl || config.DEFAULT_CLIENT_PHOTO_URL,
    }
  }
}

export default ClientRepository
