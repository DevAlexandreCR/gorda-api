import Session from '../../../Models/Session'
import {Client, Message, MessageContent, MessageTypes} from 'whatsapp-web.js'
import {Store} from '../../store/Store'
import CurrentClient from '../../../Models/Client'
import Place from '../../../Models/Place'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import SessionRepository from '../../../Repositories/SessionRepository'
import * as Messages from '../Messages'
import MessageHelper from '../../../Helpers/MessageHelper'

export abstract class ResponseContract {
  
  protected store: Store = Store.getInstance()
  protected currentClient: CurrentClient
  
  abstract messageSupported: Array<string>
  
  abstract processMessage(client: Client, session: Session, message: Message): Promise<void>
  
  isChat(message: Message): boolean {
    return message.type === MessageTypes.TEXT
  }
  
  isLocation(message: Message): boolean {
    return message.type === MessageTypes.LOCATION
  }
  
  async sendMessage(client: Client, chatId: string, content: MessageContent): Promise<void> {
    await client.sendMessage(chatId, content).catch(e => console.log(e))
  }
  
  setCurrentClient(message: Message): void {
    const client = this.store.findClientById(message.from)
    if (client) this.currentClient = client
    else {
      message.getContact().then(contact => {
        this.currentClient = new CurrentClient()
        this.currentClient.name = contact.name?? contact.number
        this.currentClient.phone = contact.number
      })
    }
  }
  
  clientExists(message: Message): boolean {
    const client = this.store.findClientById(message.from)
    if (client) this.currentClient = client
    return client != undefined
  }
  
  async createService(client: Client, message: Message, place: Place, session: Session, comment: string|null = null): Promise<void> {
    const service = new Service()
    service.client_id = session.chat_id
    service.start_loc = place
    service.phone = this.currentClient.phone
    service.name = this.currentClient.name
    if (comment) service.comment = comment
    const dbService = await ServiceRepository.create(service)
    session.service_id = dbService.id
    await SessionRepository.update(session)
      .then(async () => {
        await this.sendMessage(client, message.from, Messages.ASK_FOR_DRIVER).then(async () => {
          await session.setStatus(Session.STATUS_REQUESTING_SERVICE)
        })
      })
      .catch(async (e) => {
        console.error(e.message)
        await this.sendMessage(client, message.from, Messages.ERROR_CREATING_SERVICE)
        await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
  }
  
  
  getPlaceFromLocation(message: Message): Array<Place> {
    const locationMessage = message.location
    const place = new Place()
    if (locationMessage.description && locationMessage.description.length > 2) {
      place.name = locationMessage.description
    } else {
      place.name = MessageHelper.USER_LOCATION
    }
    place.lat = parseFloat(locationMessage.latitude)
    place.lng = parseFloat(locationMessage.longitude)
    
    return [place]
  }
  
  getPlaceFromMessage(message: Message): Array<Place> {
    const findPlace = MessageHelper.getPlace(message.body)
    const foundPlaces: Array<Place> = []
    Array.from(this.store.places).forEach(place => {
      const placeName = MessageHelper.normalize(place.name)
      if (placeName.includes(findPlace)) {
        foundPlaces.push(place)
      }
    })
    
    return foundPlaces
  }
  
  supportMessage(message: Message): boolean {
    return this.messageSupported.includes(message.type)
  }
}