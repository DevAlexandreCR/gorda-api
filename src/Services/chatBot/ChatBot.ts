import {Client, Message, MessageContent} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import * as Messages from './Messages'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import Place from '../../Models/Place'
import {Store} from '../store/Store'
import MessageHelper from '../../Helpers/MessageHelper'

export default class ChatBot {
  private client: Client
  private session: Session
  private messageFrom: string
  private service: Service
  private message: Message
  private store: Store = Store.getInstance()
  
  constructor(client: Client) {
    this.client = client
  }
  
  async processMessage(message: Message): Promise<void> {
    this.setMessage(message)
    this.setMessageFrom(message)
    this.session = new Session(message.from)
    const active = await this.isSessionActive()
    if (active) {
      await this.validateStatusSession()
    } else {
      await this.createSession().catch(e => console.log(e.message))
      await this.validateKey()
    }
  }
  
  setMessage(message: Message): void {
    this.message = message
  }
  
  setMessageFrom(message: Message): void {
    this.messageFrom = message.from
  }
  
  async validateStatusSession(): Promise<void> {
    const body = this.message.body.toLowerCase()
    switch (this.session.status) {
      case Session.STATUS_ASKING_FOR_NEIGHBORHOOD:
        await this.validatePlace()
        break
      case Session.STATUS_REQUESTING_SERVICE:
        if (body.includes(MessageHelper.CANCEL)) {
          this.cancelService()
        } else {
          await this.sendMessage(this.messageFrom, Messages.ASK_FOR_CANCEL_WHILE_FIND_DRIVER)
        }
        break
      case Session.STATUS_SERVICE_IN_PROGRESS:
        await this.sendMessage(this.messageFrom, Messages.SERVICE_IN_PROGRESS)
        break
      default:
        await this.sendMessage(this.messageFrom, Messages.ASK_FOR_NEIGHBORHOOD)
        break
    }
  }
  
  cancelService(): void {
    this.service.cancel().then(async () => await this.session.setStatus(Session.STATUS_COMPLETED)
    )
  }
  
  async isSessionActive(): Promise<boolean> {
    const session = await SessionRepository.findSessionByChatId(this.message.from)
    if (session) {
      Object.assign(this.session, session)
      if (session.service_id) {
        const service = await ServiceRepository.findServiceById(session.service_id)
        this.service = new Service()
        Object.assign(this.service, service)
      }
    }
    return session !== null && !this.session.isCompleted()
  }
  
  async createSession(): Promise<void> {
    await SessionRepository.create(this.session)
  }
  
  async createService(place: Place): Promise<void> {
    this.service = new Service()
    this.service.client_id = this.session.chat_id
    this.service.start_loc = place
    const chat = await this.message.getChat()
    this.service.phone = chat.id.user
    this.service.name = chat.name
    const dbService = await ServiceRepository.create(this.service)
    this.session.service_id = dbService.id
    await SessionRepository.update(this.session)
  }
  
  async validateKey(): Promise<void> {
    if (this.isLocation() || MessageHelper.hasPlace(this.message.body)) {
      await this.validatePlace()
    } else {
      await this.sendMessage(this.messageFrom, Messages.WELCOME).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD)
      })
    }
  }
  
  async validatePlace(): Promise<void> {
    let place: Array<Place> = []
    if (this.isChat()) {
      place = this.getPlaceFromMessage()
    } else {
      place = this.getPlaceFromLocation()
    }
    
    if (place.length) {
      await this.sendMessage(this.messageFrom, Messages.requestingService(place[0].name)).then(async () => {
        await this.createService(place[0])
          .then(async () => {
            await this.sendMessage(this.messageFrom, Messages.ASK_FOR_DRIVER).then(async () => {
              await this.session.setStatus(Session.STATUS_REQUESTING_SERVICE)
            })
          })
          .catch(async (e) => {
          console.log(e.message)
          await this.sendMessage(this.messageFrom, Messages.ERROR_CREATING_SERVICE)
        })
      })
    } else {
      await this.sendMessage(this.messageFrom, Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD).catch(e => console.log(e))
      })
    }
  }
  
  async sendMessage(chatId: string, content: MessageContent): Promise<void> {
    await this.client.sendMessage(chatId, content).catch(e => console.log(e))
  }
  
  getPlaceFromLocation(): Array<Place> {
    const locationMessage = this.message.location
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
  
  getPlaceFromMessage(): Array<Place> {
    const findPlace = MessageHelper.hasPlace(this.message.body)
    const foundPlaces: Array<Place> = []
    if (findPlace)
    Array.from(this.store.places).some(place => {
      const placeName = MessageHelper.normalice(place.name)
      if (placeName.includes(findPlace)) {
        foundPlaces.push(place)
        return true
      }
    })
    
    return foundPlaces
  }
  
  isChat(): boolean {
    return this.message.type === 'chat'
  }
  
  isLocation(): boolean {
    return this.message.type === 'location'
  }
}