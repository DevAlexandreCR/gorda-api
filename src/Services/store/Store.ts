import Driver from '../../Models/Driver'
import Place from '../../Models/Place'
import PlaceRepository from '../../Repositories/PlaceRepository'
import DriverRepository from '../../Repositories/DriverRepository'
import ClientRepository from '../../Repositories/ClientRepository'
import Client from '../../Models/Client'
import {ChatBotMessage} from '../../Types/ChatBotMessage'
import SettingsRepository from '../../Repositories/SettingsRepository'
import {MessagesEnum} from '../chatBot/MessagesEnum'

export class Store {
  
  static instance: Store;
  drivers: Set<Driver> = new Set<Driver>()
  places: Set<Place> = new Set<Place>()
  clients: Map<string, Client> = new Map()
  messages: Map<MessagesEnum, ChatBotMessage> = new Map()
  
  private constructor() {
    this.setDrivers()
    this.setPlaces()
    this.setClients()
    this.listenMessages()
  }
  
  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store();
    }
    return Store.instance;
  }
  
  private setPlaces() {
    PlaceRepository.getAll((place) => {
      this.places.add(place)
    })
  }
  
  private setClients() {
    ClientRepository.onClient((client) => {
      this.clients.set(client.id, client)
    }, (clientId) => {
      if (clientId) this.clients.delete(clientId)
    })
  }
  
  private setDrivers() {
    DriverRepository.getAll((driver) => {
      this.drivers.add(driver)
    })
  }

  private listenMessages(): void {
    SettingsRepository.getChatBotMessages((messages) => {
      this.messages = messages
    })
  }
  
  findDriverById(driverId: string): Driver {
    const driversArray = Array.from(this.drivers)
    return  driversArray.find(dri => dri.id === driverId) ?? new Driver()
  }
  
  findClientById(clientId: string): Client|undefined {
    return this.clients.get(clientId)
  }

  findMessageById(msgId: MessagesEnum): ChatBotMessage {
    return this.messages.get(msgId) ?? {
      id: MessagesEnum.MESSAGE_NOT_FOUND,
      name: MessagesEnum.MESSAGE_NOT_FOUND,
      description: MessagesEnum.MESSAGE_NOT_FOUND,
      message: MessagesEnum.MESSAGE_NOT_FOUND,
      enabled: true
    } as ChatBotMessage
  }
  
  findPlaceById(placeId: string): Place|undefined {
    const placesArray = Array.from(this.places)
    return placesArray.find(pla => {
      return pla.key === placeId
    })
  }
}