import {Client, Message} from 'whatsapp-web.js'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import {SessionInterface} from '../../Interfaces/SessionInterface'
import {Agreement} from './MessageStrategy/Responses/Agreement'

export default class ChatBot {
  private readonly wpClient: Client
  // TODO: change to Map
  private sessions = new Map<string, Session>()
  
  constructor(client: Client) {
    this.wpClient = client
    SessionRepository.sessionActiveListener(async (type, session) => {
      switch (type) {
        case 'added':
          console.log('session added: ', session.id)
          session.setClient(this.wpClient)
          await session.syncMessages(true)
          this.sessions.set(session.id, session)
          break
        case 'modified':
          const sessionInMap = this.sessions.get(session.id)
          if (sessionInMap) {
            sessionInMap.status = session.status
            this.sessions.set(session.id, sessionInMap)
          }
          console.log('session modified: ', this.sessions.size, session.status)
          break
        case 'removed':
          this.removeSession(session.id)
          break
      }
    })
  }

  public removeSession(sessionId: string): void {
      console.log(this.sessions.size)
      this.sessions.delete(sessionId)
      console.log(this.sessions.size)
  }
  
  async processMessage(message: Message): Promise<void> {
    await this.findOrCreateSession(message.from, message).then(async session => {
      await session.addMsg(message)
    })
  }

  private async findOrCreateSession(chatId: string, message: Message): Promise<Session> {
    let session = this.findSessionByChatId(chatId)

    if (!session) {
      const newSession = new Session(chatId)
      if (this.isAgreement(message.body)) {
        newSession.status = Session.STATUS_AGREEMENT
      }
      session = await this.createSession(newSession)
      session.setClient(this.wpClient)
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
    for (const [_, session] of this.sessions.entries()) {
      if (session.chat_id === chatId && this.isSessionActive(session)) {
        return session
      }
    }

    return null
  }
}