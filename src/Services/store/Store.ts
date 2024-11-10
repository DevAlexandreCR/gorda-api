import Driver from '../../Models/Driver'
import Place from '../../Models/Place'
import PlaceRepository from '../../Repositories/PlaceRepository'
import DriverRepository from '../../Repositories/DriverRepository'
import ClientRepository from '../../Repositories/ClientRepository'
import Client from '../../Models/Client'
import {ChatBotMessage} from '../../Types/ChatBotMessage'
import SettingsRepository from '../../Repositories/SettingsRepository'
import {MessagesEnum} from '../chatBot/MessagesEnum'
import {ClientDictionary} from '../../Interfaces/ClientDiccionary'
import ChatRepository from '../../Repositories/ChatRepository'
import {Chat} from '../../Interfaces/Chat'
import DateHelper from '../../Helpers/DateHelper'
import {ClientInterface} from '../../Interfaces/ClientInterface'
import {WpContactInterface} from '../whatsapp/interfaces/WpContactInterface'
import {MessageTypes} from '../whatsapp/constants/MessageTypes'
import { Branch } from '../../Interfaces/Branch'

export class Store {
  static instance: Store
  drivers: Map<string, Driver> = new Map()
  places: Set<Place> = new Set<Place>()
  clients: Map<string, Client> = new Map()
  messages: Map<MessagesEnum, ChatBotMessage> = new Map()
  wpClients: ClientDictionary = {}
  wpChats: Map<string, Chat> = new Map()
  branches: Map<string, Branch> = new Map()

  private constructor() {
    this.setDrivers()
    this.updateDrivers()
    this.setPlaces()
    this.setClients()
    this.listenMessages()
  }

  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  private setPlaces() {
    PlaceRepository.getAll((place) => {
      this.places.add(place)
    })
  }

  private setClients() {
    ClientRepository.onClient(
      (client) => {
        this.clients.set(client.id, client)
      },
      (clientId) => {
        if (clientId) this.clients.delete(clientId)
      },
    )
  }

  createClient(client: WpContactInterface): Promise<ClientInterface> {
    return ClientRepository.create(client)
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

  async getChatById(wpClientId: string, chatId: string, profileName: string = 'Usuario'): Promise<Chat> {
    const chat = this.wpChats.get(chatId)

    if (chat) {
      return chat
    } else {
      return await ChatRepository.addChat(wpClientId, {
        id: chatId,
        created_at: DateHelper.unix(),
        updated_at: DateHelper.unix(),
        archived: false,
        lastMessage: {
          created_at: DateHelper.unix(),
          body: MessagesEnum.DEFAULT_MESSAGE,
          fromMe: true,
          id: chatId,
          type: MessageTypes.TEXT
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

  findClientById(clientId: string): Client | undefined {
    return this.clients.get(clientId)
  }

  findMessageById(msgId: MessagesEnum): ChatBotMessage {
    return (
      this.messages.get(msgId) ??
      ({
        id: MessagesEnum.DEFAULT_MESSAGE,
        name: MessagesEnum.DEFAULT_MESSAGE,
        description: MessagesEnum.DEFAULT_MESSAGE,
        message: MessagesEnum.DEFAULT_MESSAGE,
        enabled: true,
      } as ChatBotMessage)
    )
  }

  findPlaceById(placeId: string): Place | undefined {
    const placesArray = Array.from(this.places)
    return placesArray.find((pla) => {
      return pla.key === placeId
    })
  }

  getBranches(): void {
    SettingsRepository.getBranches((branches) => {
      branches.forEach((branch) => {
        this.branches.set(branch.id, branch)
      })
    })
  }
}
