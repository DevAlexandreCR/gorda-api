import {Client, Message, MessageContent} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import * as Messages from './Messages'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import {SessionInterface} from '../../Interfaces/SessionInterface'
import {ServiceInterface} from '../../Interfaces/ServiceInterface'

export default class ChatBot {
  private client: Client
  private session: Session
  private messageFrom: string
  
  constructor(client: Client) {
    this.client = client
  }
  
  
  async processMessage(message: Message): Promise<void> {
    const active = await this.isSessionActive(message)
    if (!active) {
      await this.createSession(message)
        .catch(e => console.log(e.message))
    }
    await this.validateKey(message)
  }
  
  async isSessionActive(message: Message): Promise<boolean> {
    const session = await SessionRepository.findSessionByChatId(message.from)
    this.messageFrom = message.from
    session ? this.session = Object.assign({}, session) : null
    return session !== null
  }
  
  async createSession(message: Message): Promise<void> {
    this.session = new Session(message.from)
    await SessionRepository.create(this.session)
  }
  
  async createService(session: Session, message: Message, neighborhood: string): Promise<void> {
    const service = new Service()
    service.client_id = session.chat_id
    service.start_address = neighborhood
    const chat = await message.getChat()
    service.phone = chat.id.user
    service.name = chat.name
    const dbService = await ServiceRepository.create(service)
    session.service_id = dbService.id
    await SessionRepository.update(session)
  }
  
  async validateKey(message: Message): Promise<void> {
    if (message.body.toLowerCase().includes('servicio')) {
      await this.sendMessage(this.messageFrom, Messages.ASK_FOR_NEIGHBORHOOD).then(async () => {
        await this.setSessionStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD)
      })
    } else if (message.body.toLowerCase().includes('barrio')) {
      const neighborhood = this.getNeighborhood(message)
      if (neighborhood) {
        await this.sendMessage(this.messageFrom, Messages.requestingService(neighborhood)).then(async () => {
          await this.createService(this.session, message, neighborhood)
          this.sendMessage(this.messageFrom, Messages.ASK_FOR_DRIVER).then(async () => {
            await this.setSessionStatus(Session.STATUS_REQUESTING_SERVICE)
          })
        })
      } else {
        await this.sendMessage(this.messageFrom, Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
          await this.setSessionStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD)
        })
      }
    } else {
      await this.sendMessage(this.messageFrom, Messages.ASK_FOR_NEIGHBORHOOD).then(async () => {
        await this.setSessionStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD)
      })
    }
  }
  
  async setSessionStatus(status: string): Promise<void> {
    this.session.status = status
    await SessionRepository.update(this.session)
  }
  
  async sendMessage(chatId: string, content: MessageContent): Promise<void> {
    await this.client.sendMessage(chatId, content)
  }
  
  getNeighborhood(message: Message): string|null {
    const indexInit = message.body.indexOf('-')
    const indexEnd = message.body.toLowerCase().lastIndexOf('-')
    return message.body.toLowerCase().substring(indexInit, indexEnd)
  }
}