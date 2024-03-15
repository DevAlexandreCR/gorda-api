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
    SessionRepository.sessionActiveListener(async (type, session) => {
      switch (type) {
        case 'added':
          session.setClient(this.wpClient)
          await session.syncMessages()
          this.sessions.add(session)
          break
        // case 'modified':
        //   const sessionInSet = Array.from(this.sessions).find(s => s.id === session.id)
        //   if (sessionInSet) {
        //     this.sessions.delete(sessionInSet)
        //     this.sessions.add(session)
        //   }
        //   break
        case 'removed':
          this.removeSession(session.id)
          break
      }
    })
  }

  public removeSession(sessionId: string): void {
    const sessionInSet = Array.from(this.sessions).find(s => s.id === sessionId)
    if (sessionInSet) {
      this.sessions.delete(sessionInSet)
    }
  }
  
  async processMessage(message: Message): Promise<void> {
    await this.findOrCreateSession(message.from, message).then(async session => {
      await session.addMsg(message)
    })
  }

  private async findOrCreateSession(chatId: string, message: Message): Promise<Session> {
    let session = this.findSessionByChatId(chatId)

    if (!session) {
      session = await this.createSession(new Session(chatId))
      session.setClient(this.wpClient)
      if (this.isAgreement(message.body)) {
        session.status = Session.STATUS_AGREEMENT
      }
      this.sessions.add(session)
    }

    return session
  }
  
  isSessionActive(session: SessionInterface): boolean {
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
    const sessionInSet = Array.from(this.sessions).find(s => s.chat_id === chatId)
    return sessionInSet ?? null
  }
}