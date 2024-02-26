import {Client, Message} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import {ResponseContext} from './MessageStrategy/ResponseContext'
import {SessionInterface} from '../../Interfaces/SessionInterface'
import { Agreement } from './MessageStrategy/Responses/Agreement'

export default class ChatBot {
  private readonly wpClient: Client
  private sessions = new Set<Session>()
  
  constructor(client: Client) {
    this.wpClient = client
    SessionRepository.getActiveSessions().then(sessions => {
      sessions.forEach(session => {
        const sessionObject = new Session(session.chat_id)
        sessionObject.setClient(this.wpClient)
        this.sessions.add(Object.assign(sessionObject, session))
      })
    })
  }
  
  async processMessage(message: Message): Promise<void> {
    await this.findOrCreateSession(message.from, message).then(async session => {
      await session.addMsg(message)
    })
  }

  private async findOrCreateSession(chatId: string, message: Message): Promise<Session> {
    let session = this.findSessionByChatId(chatId);
    const active = session ? await this.isSessionActive(session) : false

    if (!session || !active) {
      session = await this.createSession(new Session(chatId))
    } else if (this.isAgreement(message.body)) {
      session.status = Session.STATUS_AGREEMENT
    }
    session.setClient(this.wpClient)
    this.sessions.add(session)

    return session
  }
  
  async isSessionActive(session: SessionInterface): Promise<boolean> {
    return session.status !== Session.STATUS_COMPLETED
  }

  isAgreement(message: string): boolean {
    return message.includes(Agreement.AGREEMENT)
  }
  
  async createSession(session: Session): Promise<Session> {
    const sessionDB = await SessionRepository.create(session)
    return Object.assign(session, sessionDB)
  }

  findSessionByChatId(chatId: string): Session|null {
    for (const session of this.sessions) {
      if (session.chat_id === chatId) return session
    }
    return null
  }
}