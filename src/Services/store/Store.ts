import Driver from '../../Models/Driver'
import Container from '../../Container/Container'
import { ChatBotMessage } from '../../Types/ChatBotMessage'
import { MessagesEnum } from '../chatBot/MessagesEnum'
import { ClientDictionary } from '../../Interfaces/ClientDiccionary'
import ChatRepository from '../../Repositories/ChatRepository'
import { Chat } from '../../Interfaces/Chat'
import DateHelper from '../../Helpers/DateHelper'
import { ClientInterface } from '../../Interfaces/ClientInterface'
import { WhatsAppClientDictionary } from '../../Interfaces/WhatsAppClientDiccionary'
import { WpContactInterface } from '../whatsapp/interfaces/WpContactInterface'
import { MessageTypes } from '../whatsapp/constants/MessageTypes'
import { Branch } from '../../Interfaces/Branch'
import { City } from '../../Interfaces/City'
import { LatLng } from '../../Interfaces/LatLng'
import { Feature, Polygon, Position } from 'geojson'
import { PlaceInterface } from '../../Interfaces/PlaceInterface'
import { WpClient } from '../../Interfaces/WpClient'

export class Store {
  static instance: Store
  drivers: Map<string, Driver> = new Map()
  clients: Map<string, ClientInterface> = new Map()
  messages: Map<MessagesEnum, ChatBotMessage> = new Map()
  wpClients: ClientDictionary = {}
  wpChats: Map<string, Chat> = new Map()
  branches: Map<string, Branch> = new Map()
  whatsappClients: WhatsAppClientDictionary = {}
  cities: Map<string, City> = new Map()
  polygons: Array<Feature<Polygon>> = new Array()
  placeRepository = Container.getPlaceRepository()
  placeSearchRepository = Container.getPlaceSearchRepository()
  clientRepository = Container.getClientRepository()
  driverRepository = Container.getDriverRecordRepository()
  masterDataRepository = Container.getMasterDataRepository()
  private wpClientListeners: Array<(clients: ClientDictionary) => void> = []

  private constructor() {
    this.setClients()
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
    this.driverRepository.index().then((drivers) => {
      this.drivers.clear()
      drivers.forEach((driverData) => {
        const driver = this.driverRepository.toDriverModel(driverData)
        if (!driver.id) return
        this.drivers.set(driver.id, driver)
      })
    })
  }

  async refreshDrivers(): Promise<void> {
    const drivers = await this.driverRepository.index()
    this.drivers.clear()
    drivers.forEach((driverData) => {
      const driver = this.driverRepository.toDriverModel(driverData)
      this.drivers.set(driver.id!, driver)
    })
  }

  async refreshMessages(): Promise<void> {
    this.messages = await this.masterDataRepository.getChatBotMessagesMap()
  }

  async refreshWpClients(): Promise<ClientDictionary> {
    const clients = await this.masterDataRepository.listWpClients()
    const mappedClients: ClientDictionary = {}

    clients.forEach((client: WpClient) => {
      mappedClients[client.id] = client
    })

    this.wpClients = mappedClients
    this.wpClientListeners.forEach((listener) => listener(this.wpClients))
    return this.wpClients
  }

  getWpClients(listener?: (clients: ClientDictionary) => void): void {
    if (listener) {
      this.wpClientListeners.push(listener)
      if (Object.keys(this.wpClients).length > 0) {
        listener(this.wpClients)
      }
    }

    void this.refreshWpClients()
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
    if (normalizedId) {
      return (
        this.clients.get(normalizedId) ??
        this.clients.get(`${normalizedId}@c.us`) ??
        this.clients.get(`+${normalizedId}`) ??
        this.clients.get(clientId)
      )
    }

    return this.clients.get(clientId)
  }

  private cacheClient(client: ClientInterface): void {
    const normalizedId = this.normalizeClientId(client.id)
    if (!normalizedId) return

    this.clients.set(normalizedId, client)
    this.clients.set(`${normalizedId}@c.us`, client)

    if (client.phone) {
      this.clients.set(client.phone, client)
    }
  }

  private normalizeClientId(clientId: string): string {
    if (!clientId) return ''
    const digits = clientId.toString().replace(/[^\d]/g, '')
    return digits
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

  async getBranches(): Promise<void> {
    const branches = await this.masterDataRepository.getBranches()
    this.branches.clear()
    this.cities.clear()

    branches.forEach((branch) => {
      this.branches.set(branch.id, branch)
      branch.cities.forEach((city) => {
        this.cities.set(city.id, city)
        const coordinates: GeoJSON.Position[] = []

        if (city.polygon.length == 0) return

        Array.from(city.polygon.values()).forEach((latLng: LatLng) => {
          coordinates.push([latLng.lng, latLng.lat])
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
      if (branch.cities.some((city) => city.id === cityId)) {
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

  registerWhatsAppClient(clientId: string, whatsappClient: any): void {
    this.whatsappClients[clientId] = whatsappClient
  }

  getWhatsAppClient(clientId: string): any | undefined {
    return this.whatsappClients[clientId]
  }
}
