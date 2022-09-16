import {Client, Message} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import {ResponseContext} from './MessageStrategy/ResponseContext'
import {SessionInterface} from '../../Interfaces/SessionInterface'

export default class ChatBot {
  private readonly wpClient: Client
  private messageFrom: string
  private message: Message
  
  constructor(client: Client) {
    this.wpClient = client
  }
  
  async processMessage(message: Message): Promise<void> {
    this.setMessage(message)
    this.setMessageFrom(message)
    let session = new Session(message.from)
    let sessionDB = await SessionRepository.findSessionByChatId(this.message.from)
    const active = await this.isSessionActive(sessionDB)
    if (active) {
      Object.assign(session, sessionDB)
    } else {
      session = await this.createSession(session)
    }
    const status = session.status as keyof typeof ResponseContext.RESPONSES
    const handler = ResponseContext.RESPONSES[status]
    const response = new ResponseContext(handler)
    await response.processMessage(session, message, this.wpClient)
  }
  
  setMessage(message: Message): void {
    this.message = message
  }
  
  setMessageFrom(message: Message): void {
    this.messageFrom = message.from
  }
  
  async isSessionActive(session: SessionInterface|null): Promise<boolean> {
    return session !== null && session.status !== Session.STATUS_COMPLETED
  }
  
  async createSession(session: Session): Promise<Session> {
    const sessionDB = await SessionRepository.create(session)
    return Object.assign(session, sessionDB)
  }
}