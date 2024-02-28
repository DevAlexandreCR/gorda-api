import {Client, Message} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import {SessionInterface} from '../../Interfaces/SessionInterface'
import {Agreement} from './MessageStrategy/Responses/Agreement'

export default class ChatBot {
  private readonly wpClient: Client
  private sessions = new Set<Session>()
  
  constructor(client: Client) {
    this.wpClient = client
    SessionRepository.getActiveSessions().then(async sessions => {
      for (const session of sessions) {
        const sessionObject = new Session(session.chat_id)
        Object.assign(sessionObject, session)
        sessionObject.setClient(this.wpClient)
        await sessionObject.syncMessages()
        this.sessions.add(sessionObject)
      }
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
      await session.syncMessages()
    } else {
      await session.syncMessages()
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