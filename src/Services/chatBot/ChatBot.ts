import {Client, Message} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import {ResponseContext} from './MessageStrategy/ResponseContext'

export default class ChatBot {
  private readonly wpClient: Client
  private session: Session
  private messageFrom: string
  private message: Message
  
  constructor(client: Client) {
    this.wpClient = client
  }
  
  async processMessage(message: Message): Promise<void> {
    this.setMessage(message)
    this.setMessageFrom(message)
    this.session = new Session(message.from)
    const active = await this.isSessionActive()
    if (!active) {
      await this.createSession().catch(e => console.log(e.message))
    }
    await this.validateStatusSession()
  }
  
  setMessage(message: Message): void {
    this.message = message
  }
  
  setMessageFrom(message: Message): void {
    this.messageFrom = message.from
  }
  
  async validateStatusSession(): Promise<void> {
    const status = this.session.status as keyof typeof ResponseContext.RESPONSES
    const handler = ResponseContext.RESPONSES[status]
    const response = new ResponseContext(handler)
    await response.processMessage(this.session, this.message, this.wpClient)
  }
  
  async isSessionActive(): Promise<boolean> {
    const session = await SessionRepository.findSessionByChatId(this.message.from)
    if (session) {
      Object.assign(this.session, session)
    }
    return session !== null && !this.session.isCompleted()
  }
  
  async createSession(): Promise<void> {
    await SessionRepository.create(this.session)
  }
}