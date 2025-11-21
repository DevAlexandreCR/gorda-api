import Driver from '../../Models/Driver'
import Container from '../../Container/Container'
import DriverRepository from '../../Repositories/DriverRepository'
import { ChatBotMessage } from '../../Types/ChatBotMessage'
import SettingsRepository from '../../Repositories/SettingsRepository'
import { MessagesEnum } from '../chatBot/MessagesEnum'
import { ClientDictionary } from '../../Interfaces/ClientDiccionary'
import ChatRepository from '../../Repositories/ChatRepository'
import { Chat } from '../../Interfaces/Chat'
import DateHelper from '../../Helpers/DateHelper'
import { ClientInterface } from '../../Interfaces/ClientInterface'
import { WpContactInterface } from '../whatsapp/interfaces/WpContactInterface'
import { MessageTypes } from '../whatsapp/constants/MessageTypes'
import { Branch } from '../../Interfaces/Branch'
import { City } from '../../Interfaces/City'
import { LatLng } from '../../Interfaces/LatLng'
import { Feature, Polygon, Position } from 'geojson'
import { PlaceInterface } from '../../Interfaces/PlaceInterface'

export class Store {
  static instance: Store
  drivers: Map<string, Driver> = new Map()
  clients: Map<string, ClientInterface> = new Map()
  messages: Map<MessagesEnum, ChatBotMessage> = new Map()
  wpClients: ClientDictionary = {}
  wpChats: Map<string, Chat> = new Map()
  branches: Map<string, Branch> = new Map()
  cities: Map<string, City> = new Map()
  polygons: Array<Feature<Polygon>> = new Array()
  placeRepository = Container.getPlaceRepository()
  placeSearchRepository = Container.getPlaceSearchRepository()
  clientRepository = Container.getClientRepository()

  private constructor() {
    this.setDrivers()
    this.updateDrivers()
    this.setClients()
    this.listenMessages()
  }

  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  private setClients() {
    this.clientRepository
      .index()
      .then((clients) => {
        clients.forEach((client) => this.cacheClient(client))
      })
      .catch((error) => {
        console.error('Error loading clients from database:', error)
      })
  }

  async createClient(client: WpContactInterface): Promise<ClientInterface> {
    const createdClient = await this.clientRepository.create(client)
    this.cacheClient(createdClient)
    return createdClient
  }

  private setDrivers() {
    DriverRepository.getAll((driver) => {
      this.drivers.set(driver.id!, driver)
    })
  }

  private updateDrivers() {
    DriverRepository.updateDriver((driver) => {
      this.drivers.set(driver.id!, driver)
    })
  }

  private listenMessages(): void {
    SettingsRepository.getChatBotMessages((messages) => {
      this.messages = messages
    })
  }

  getWpClients(listener?: (clients: ClientDictionary) => void): void {
    SettingsRepository.getWpClients((clients: ClientDictionary) => {
      this.wpClients = clients
      if (listener) listener(clients)
    })
  }

  getChats(wpClientId: string): void {
    ChatRepository.getChats(wpClientId, (chats) => {
      chats.forEach((chat) => {
        this.wpChats.set(chat.id, chat)
      })
    })
  }

  async getChatById(
    wpClientId: string,
    chatId: string,
    profileName: string = 'Usuario'
  ): Promise<Chat> {
    const chat = this.wpChats.get(chatId.replace('@c.us', ''))

    if (chat) {
      return chat
    } else {
      return await ChatRepository.addChat(wpClientId, {
        id: chatId.replace('@c.us', ''),
        created_at: DateHelper.unix(),
        updated_at: DateHelper.unix(),
        archived: false,
        lastMessage: {
          created_at: DateHelper.unix(),
          body: MessagesEnum.DEFAULT_MESSAGE,
          fromMe: true,
          id: chatId.replace('@c.us', ''),
          type: MessageTypes.TEXT,
          interactive: null,
          interactiveReply: null,
        },
        clientName: profileName,
      })
    }
  }

  addChat(wpClientId: string, chat: Chat): Promise<Chat> {
    return ChatRepository.addChat(wpClientId, chat)
  }

  findDriverById(driverId: string): Driver {
    return this.drivers.get(driverId) ?? new Driver()
  }

  findClientById(clientId: string): ClientInterface | undefined {
    if (!clientId) return undefined
    const normalizedId = this.normalizeClientId(clientId)
    return (
      this.clients.get(normalizedId) ??
      this.clients.get(normalizedId.replace('@c.us', '')) ??
      this.clients.get(clientId)
    )
  }

  private cacheClient(client: ClientInterface): void {
    const normalizedId = this.normalizeClientId(client.id)
    if (!normalizedId) return

    this.clients.set(normalizedId, client)

    const numericKey = normalizedId.replace('@c.us', '')
    if (numericKey) {
      this.clients.set(numericKey, client)
    }
  }

  private normalizeClientId(clientId: string): string {
    if (!clientId) return ''
    const trimmed = clientId.trim()
    if (!trimmed) return ''

    if (trimmed.endsWith('@c.us')) {
      return trimmed
    }

    const digits = trimmed.replace(/[^\d]/g, '')
    return digits ? `${digits}@c.us` : trimmed
  }

  findMessageById(msgId: MessagesEnum): ChatBotMessage {
    const exists = this.messages.has(msgId)
    if (exists) {
      const originalMessage = this.messages.get(msgId) as ChatBotMessage
      return JSON.parse(JSON.stringify(originalMessage))
    } else {
      return {
        id: MessagesEnum.DEFAULT_MESSAGE,
        name: MessagesEnum.DEFAULT_MESSAGE,
        description: MessagesEnum.DEFAULT_MESSAGE,
        message: MessagesEnum.DEFAULT_MESSAGE,
        enabled: true,
      } as ChatBotMessage
    }
  }

  findPlaceById(placeId: string): Promise<PlaceInterface | null> {
    const placeRepository = Container.getPlaceRepository()
    return placeRepository.findById(placeId)
  }

  getBranches(): void {
    SettingsRepository.getBranches((branches) => {
      branches.forEach((branch) => {
        this.branches.set(branch.id, branch)
        Array.from(branch.cities).forEach(([id, city]) => {
          this.cities.set(city.id, city)
          const coordinates: GeoJSON.Position[] = []

          if (city.polygon.length == 0) return

          Array.from(city.polygon.values()).forEach((latLng: LatLng) => {
            coordinates.push([latLng.lng, latLng.lat])
          })

          // this.polygons.push(polygon([coordinates], { name: city.id }))
        })
      })
    })
  }

  findCityById(cityId: string): City | undefined {
    return this.cities.get(cityId)
  }

  findCountryByCity(cityId: string): string {
    let country = ''
    this.branches.forEach((branch) => {
      if (branch.cities.has(cityId)) {
        country = branch.id
      }
    })
    return country
  }

  async findPlaceByName(placeName: string, cityId?: string): Promise<PlaceInterface | null> {
    const searchResult = await this.placeSearchRepository.searchWithSuggestions(placeName, {
      cityId: cityId || 'popayan',
      limit: 1,
      minScore: 0.3
    })

    return searchResult.results[0] || null
  }

  async findPlacesWithSuggestions(placeName: string, cityId?: string): Promise<{
    place: PlaceInterface | null
    suggestions: Array<{ id: string, name: string }>
    hasExactMatch: boolean
  }> {
    const searchResult = await this.placeSearchRepository.searchWithSuggestions(placeName, {
      cityId: cityId || 'popayan',
      limit: 5,
      minScore: 0.2
    })

    return {
      place: searchResult.results[0] || null,
      suggestions: searchResult.suggestions,
      hasExactMatch: searchResult.hasExactMatch
    }
  }
}
