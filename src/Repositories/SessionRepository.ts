import { randomUUID } from 'crypto'
import { Op } from 'sequelize'
import Database from '../Services/firebase/Database'
import { SessionInterface } from '../Interfaces/SessionInterface'
import Session from '../Models/Session'
import { WpMessage } from '../Types/WpMessage'
import { WpNotifications } from '../Types/WpNotifications'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
import { WpMessageInterface } from '../Services/whatsapp/interfaces/WpMessageInterface'
import ChatSessionRecord from '../Models/ChatSessionRecord'
import WhatsappMessageRecord from '../Models/WhatsappMessageRecord'
import ChatIdHelper from '../Helpers/ChatIdHelper'
import ChatRealtimeGateway from '../Services/whatsapp/ChatRealtimeGateway'
import ChatRepository from './ChatRepository'

class SessionRepository {
  public async findSessionByChatId(chatId: string): Promise<SessionInterface | null> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const sessionRecord = await ChatSessionRecord.findOne({
      where: {
        chatId: normalizedChatId,
        status: {
          [Op.notIn]: [Session.STATUS_COMPLETED],
        },
      },
      order: [['created_at', 'DESC']],
    })

    return sessionRecord ? this.mapSession(sessionRecord) : null
  }

  public async findSessionById(sessionId: string): Promise<SessionInterface | null> {
    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    return sessionRecord ? this.mapSession(sessionRecord) : null
  }

  public async updateId(session: SessionInterface): Promise<SessionInterface> {
    const sessionRecord = await ChatSessionRecord.findByPk(session.id)
    if (!sessionRecord) {
      return session
    }

    sessionRecord.assigned_at = session.assigned_at ?? sessionRecord.assigned_at
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()
    await this.emitSessionUpdate(this.mapSession(sessionRecord))

    return session
  }

  public async getMessages(sessionId: string): Promise<Map<string, WpMessage>> {
    const messages: Map<string, WpMessage> = new Map()
    const records = await WhatsappMessageRecord.findAll({
      where: { chatSessionId: sessionId },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    })

    records.forEach((record) => {
      messages.set(record.messageId, {
        created_at: Number(record.created_at),
        id: record.messageId,
        type: record.type,
        msg: record.body,
        processed: Boolean(record.processed),
        location: record.location ?? null,
        interactiveReply: record.interactiveReply ?? null,
        interactive: record.interactive ?? null,
      })
    })

    return messages
  }

  public async updateStatus(session: SessionInterface): Promise<SessionInterface> {
    const sessionRecord = await ChatSessionRecord.findByPk(session.id)
    if (!sessionRecord) {
      return session
    }

    sessionRecord.status = session.status
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()

    const mappedSession = this.mapSession(sessionRecord)
    await this.emitSessionUpdate(mappedSession)

    return session
  }

  public async updateService(session: SessionInterface): Promise<SessionInterface> {
    const sessionRecord = await ChatSessionRecord.findByPk(session.id)
    if (!sessionRecord) {
      return session
    }

    sessionRecord.service_id = session.service_id
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()
    await this.emitSessionUpdate(this.mapSession(sessionRecord))

    return session
  }

  public async updatePlace(session: SessionInterface): Promise<SessionInterface> {
    const sessionRecord = await ChatSessionRecord.findByPk(session.id)
    if (!sessionRecord) {
      return session
    }

    sessionRecord.place = session.place ? { ...session.place } : null
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()
    await this.emitSessionUpdate(this.mapSession(sessionRecord))

    return session
  }

  public async updatePlaceOptions(session: SessionInterface): Promise<SessionInterface> {
    const sessionRecord = await ChatSessionRecord.findByPk(session.id)
    if (!sessionRecord) {
      return session
    }

    sessionRecord.placeOptions = session.placeOptions ?? []
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()
    await this.emitSessionUpdate(this.mapSession(sessionRecord))

    return session
  }

  public async updateNotification(
    sessionId: string,
    notifications: WpNotifications
  ): Promise<void> {
    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    if (!sessionRecord) {
      return
    }

    sessionRecord.notifications = notifications
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()
    await this.emitSessionUpdate(this.mapSession(sessionRecord))
  }

  public async create(session: SessionInterface): Promise<SessionInterface> {
    const record = await ChatSessionRecord.create({
      id: session.id || randomUUID(),
      wpClientId: session.wp_client_id,
      chatId: ChatIdHelper.normalize(session.chat_id),
      status: session.status,
      service_id: session.service_id,
      place: session.place ? { ...session.place } : null,
      placeOptions: session.placeOptions ?? [],
      notifications: session.notifications,
      assigned_at: session.assigned_at ?? 0,
      created_at: session.created_at,
      updated_at: session.updated_at ?? null,
    })

    const mappedSession = this.mapSession(record)
    ChatRealtimeGateway.emitSessionEvent('added', mappedSession)
    await ChatRepository.emitAdminChat(mappedSession.wp_client_id, mappedSession.chat_id)

    return mappedSession
  }

  public async getActiveSessions(wpClientId?: string): Promise<Array<SessionInterface>> {
    const where = {
      ...(wpClientId ? { wpClientId } : {}),
      status: {
        [Op.notIn]: [Session.STATUS_COMPLETED],
      },
    }

    const records = await ChatSessionRecord.findAll({
      where,
      order: [['created_at', 'DESC']],
    })

    return records.map((record) => this.mapSession(record))
  }

  public sessionActiveListener(
    wpClientId: string,
    listener: (type: string, session: Session) => void
  ): void {
    ChatRealtimeGateway.onSessionEvent((type, sessionData) => {
      if (sessionData.wp_client_id !== wpClientId) {
        return
      }

      const session = new Session(sessionData.chat_id)
      Object.assign(session, sessionData)
      listener(type, session)
    })
  }

  public async closeAbandoned(sessions: Array<SessionInterface>): Promise<void> {
    for (const session of sessions) {
      const sessionRecord = await ChatSessionRecord.findByPk(session.id)
      if (!sessionRecord) {
        continue
      }

      sessionRecord.status = Session.STATUS_COMPLETED
      sessionRecord.updated_at = Date.now()
      await sessionRecord.save()

      const mappedSession = this.mapSession(sessionRecord)
      ChatRealtimeGateway.emitSessionEvent('removed', mappedSession)
      await ChatRepository.emitAdminChat(mappedSession.wp_client_id, mappedSession.chat_id)
    }
  }

  public async addChat(msg: WpMessageInterface): Promise<void> {
    if (msg.type === MessageTypes.TEXT) {
      await Database.db.ref('chats').child(msg.from.replace(/\D/g, '')).push(msg.body)
    }
  }

  public async addMsg(sessionId: string, msg: WpMessage): Promise<{ created: boolean; id: string }> {
    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    if (!sessionRecord) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const [messageRecord, created] = await WhatsappMessageRecord.findOrCreate({
      where: {
        wpClientId: sessionRecord.wpClientId,
        messageId: msg.id,
      },
      defaults: {
        wpClientId: sessionRecord.wpClientId,
        chatId: sessionRecord.chatId,
        chatSessionId: sessionId,
        messageId: msg.id,
        created_at: msg.created_at,
        type: msg.type,
        body: msg.msg,
        fromMe: false,
        processed: msg.processed,
        location: msg.location,
        interactive: msg.interactive,
        interactiveReply: msg.interactiveReply,
      },
    })

    const shouldProcess = created || messageRecord.chatSessionId !== sessionId

    messageRecord.chatId = sessionRecord.chatId
    messageRecord.chatSessionId = sessionId
    messageRecord.created_at = msg.created_at
    messageRecord.type = msg.type
    messageRecord.body = msg.msg
    messageRecord.processed = msg.processed
    messageRecord.location = msg.location
    messageRecord.interactive = msg.interactive
    messageRecord.interactiveReply = msg.interactiveReply
    await messageRecord.save()

    return {
      created: shouldProcess,
      id: messageRecord.messageId,
    }
  }

  public async setProcessedMsgs(sessionId: string, msgs: WpMessage[]): Promise<void> {
    const messageIds = msgs.map((msg) => msg.id)
    if (messageIds.length === 0) {
      return
    }

    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    if (!sessionRecord) {
      return
    }

    await WhatsappMessageRecord.update(
      { processed: true, chatSessionId: sessionId },
      {
        where: {
          wpClientId: sessionRecord.wpClientId,
          messageId: {
            [Op.in]: messageIds,
          },
        },
      }
    )
  }

  public async claimSupport(sessionId: string): Promise<SessionInterface | null> {
    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    if (!sessionRecord) {
      return null
    }

    sessionRecord.status = Session.STATUS_SUPPORT
    sessionRecord.updated_at = Date.now()
    await sessionRecord.save()

    const mappedSession = this.mapSession(sessionRecord)
    await this.emitSessionUpdate(mappedSession)

    return mappedSession
  }

  private mapSession(record: ChatSessionRecord): SessionInterface {
    return {
      id: record.id,
      status: record.status,
      placeOptions: record.placeOptions ?? [],
      place: record.place ?? null,
      wp_client_id: record.wpClientId,
      chat_id: record.chatId,
      service_id: record.service_id,
      notifications: record.notifications,
      assigned_at: Number(record.assigned_at ?? 0),
      created_at: Number(record.created_at),
      updated_at: record.updated_at === null ? null : Number(record.updated_at),
    }
  }

  private async emitSessionUpdate(session: SessionInterface): Promise<void> {
    const eventType = session.status === Session.STATUS_COMPLETED ? 'removed' : 'modified'
    ChatRealtimeGateway.emitSessionEvent(eventType, session)
    await ChatRepository.emitAdminChat(session.wp_client_id, session.chat_id)
  }
}

export default new SessionRepository()
