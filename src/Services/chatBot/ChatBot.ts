import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import { SessionInterface } from '../../Interfaces/SessionInterface'
import { Agreement } from './MessageStrategy/Responses/Agreement'
import { WPClientInterface } from '../whatsapp/interfaces/WPClientInterface'
import { WpMessageInterface } from '../whatsapp/interfaces/WpMessageInterface'
import ChatIdHelper from '../../Helpers/ChatIdHelper'
import { WpClients } from '../whatsapp/constants/WPClients'

export default class ChatBot {
  private readonly wpClient: WPClientInterface
  private readonly wpClientId: string
  private sessions = new Map<string, Session>()

  constructor(client: WPClientInterface, wpClientId: string) {
    this.wpClient = client
    this.wpClientId = wpClientId
  }

  private async syncSessions(): Promise<void> {
    await SessionRepository.getActiveSessions(this.wpClientId).then(async (sessions) => {
      sessions.forEach((sessionData) => {
        const session = new Session(sessionData.chat_id)
        Object.assign(session, sessionData)
        const providerChatId = ChatIdHelper.toProviderChatId(
          session.chat_id,
          this.wpClient.serviceName as WpClients
        )

        this.wpClient.getChatById(providerChatId).then((chat) => {
          session.setChat(chat)
          session.syncMessages(true).then(() => {
            this.sessions.set(session.id, session)
          })
        })
      })
    })
  }

  public sync(): void {
    this.syncSessions().then(() => {
      SessionRepository.sessionActiveListener(this.wpClientId, async (type, session) => {
        switch (type) {
          case 'added':
            const providerChatId = ChatIdHelper.toProviderChatId(
              session.chat_id,
              this.wpClient.serviceName as WpClients
            )
            const chat = await this.wpClient.getChatById(providerChatId)
            session.setChat(chat)
            session.setWpClientId(this.wpClientId)
            this.sessions.set(session.id, session)
            break
          case 'modified':
            const sessionInMap = this.sessions.get(session.id)
            if (sessionInMap) {
              sessionInMap.status = session.status
              sessionInMap.place = session.place
              sessionInMap.notifications = session.notifications
              sessionInMap.wp_client_id = session.wp_client_id
              sessionInMap.placeOptions = session.placeOptions
              sessionInMap.created_at = session.created_at
              sessionInMap.updated_at = session.updated_at
              sessionInMap.service_id = session.service_id
              this.sessions.set(session.id, sessionInMap)
            }
            break
          case 'removed':
            this.removeSession(session.id)
            break
        }
      })
    })
  }

  public removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  async processMessage(message: WpMessageInterface): Promise<void> {
    await this.findOrCreateSession(message.from, message).then(async (session) => {
      await session.addMsg(message)
    })
  }

  private async findOrCreateSession(chatId: string, message: WpMessageInterface): Promise<Session> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    let session = this.findSessionByChatId(normalizedChatId)

    if (!session) {
      const newSession = new Session(normalizedChatId)
      newSession.setWpClientId(this.wpClientId)
      // if (this.isAgreement(message.body)) {
      //   newSession.status = Session.STATUS_AGREEMENT // TODO: Handle agreement status
      // }
      session = await this.createSession(newSession)
      const chat = await message.getChat()
      session.setChat(chat)
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

  findSessionByChatId(chatId: string): Session | null {
    const normalizedChatId = ChatIdHelper.normalize(chatId)

    for (const [_, session] of this.sessions.entries()) {
      if (
        session.chat_id === normalizedChatId &&
        this.isSessionActive(session) &&
        session.wp_client_id === this.wpClientId
      ) {
        return session
      }
    }

    return null
  }
}
