import {Client, Message, MessageContent} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import * as Messages from './Messages'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'

export default class ChatBot {
  private client: Client
  private session: Session
  private messageFrom: string
  private service: Service
  private message: Message
  
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
        if (body.includes('barrio')) {
          await this.validateNeighborhood()
        } else {
          await this.sendMessage(this.messageFrom, Messages.ASK_FOR_NEIGHBORHOOD)
        }
        break
      case Session.STATUS_REQUESTING_SERVICE:
        if (body.includes('cancelar')) {
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
    this.service.cancel().then(() => {
      this.setSessionStatus(Session.STATUS_COMPLETED).then(async () => {
        await this.sendMessage(this.messageFrom, Messages.CANCELED)
      })
    })
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
  
  async createService(neighborhood: string): Promise<void> {
    this.service = new Service()
    this.service.client_id = this.session.chat_id
    this.service.start_address = neighborhood
    const chat = await this.message.getChat()
    this.service.phone = chat.id.user
    this.service.name = chat.name
    const dbService = await ServiceRepository.create(this.service)
    this.session.service_id = dbService.id
    await SessionRepository.update(this.session)
  }
  
  async validateKey(): Promise<void> {
    const body = this.message.body.toLowerCase()
    if (body.includes('barrio')) {
      await this.validateNeighborhood()
    } else {
      await this.sendMessage(this.messageFrom, Messages.WELCOME).then(async () => {
        await this.setSessionStatus(Session.STATUS_ASKING_FOR_NEIGHBORHOOD)
      })
    }
  }
  
  async validateNeighborhood(): Promise<void> {
    const neighborhood = this.getNeighborhood()
    if (neighborhood) {
      await this.sendMessage(this.messageFrom, Messages.requestingService(neighborhood)).then(async () => {
        await this.createService(neighborhood)
          .then(async () => {
            await this.sendMessage(this.messageFrom, Messages.ASK_FOR_DRIVER).then(async () => {
              await this.setSessionStatus(Session.STATUS_REQUESTING_SERVICE)
            })
          })
          .catch(async (e) => {
          console.log(e.message)
          await this.sendMessage(this.messageFrom, Messages.ERROR_CREATING_SERVICE)
        })
      })
    } else {
      await this.sendMessage(this.messageFrom, Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
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
  
  getNeighborhood(): string|null {
    const indexInit = this.message.body.indexOf(' ') + 1
    return this.message.body.toLowerCase().substring(indexInit)
  }
}