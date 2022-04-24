import {Client, Message, MessageContent} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'

export default class ChatBot {
  private client: Client
  private session: Session
  private messageFrom: string
  
  constructor(client: Client) {
    this.client = client
  }
  
  
  async processMessage(message: Message): Promise<void> {
    if (!this.isSessionActive()) {
      await this.createSession(message)
      this.validateKey(message)
    }
  }
  
  isSessionActive(): boolean {
    return false
  }
  
  async createSession(message: Message): Promise<void> {
    this.messageFrom = message.from
    const session = await SessionRepository.create(new Session(message.from))
    this.session = Object.assign({}, session)
  }
  
  validateKey(message: Message): void {
    if (message.body.includes('servicio')) {
      this.sendMessage(this.messageFrom, 'solicitando servicio para el barrio X').then(async () => {
        await this.setSessionStatus('pending')
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
}