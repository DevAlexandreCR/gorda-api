import { randomUUID } from 'crypto'
import { Op } from 'sequelize'
import { SessionInterface } from '../Interfaces/SessionInterface'
import Session from '../Models/Session'
import { WpMessage } from '../Types/WpMessage'
import { WpNotifications } from '../Types/WpNotifications'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
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
      order: [
        ['created_at', 'ASC'],
        ['id', 'ASC'],
      ],
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
        fromMe: Boolean(record.fromMe),
      })
    })

    return messages
  }

  public async getNewestUnprocessedMessageId(sessionId: string): Promise<string | null> {
    // Only the customer's own messages matter for the supersede check; outbound
    // (fromMe) messages are always saved as processed by addMsg, so this filter
    // is defensive rather than load-bearing on that invariant.
    const record = await WhatsappMessageRecord.findOne({
      where: {
        chatSessionId: sessionId,
        processed: false,
        fromMe: false,
      },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    })

    return record ? record.messageId : null
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

  public async addMsg(
    sessionId: string,
    msg: WpMessage,
    fromMe = false
  ): Promise<{ created: boolean; id: string }> {
    const sessionRecord = await ChatSessionRecord.findByPk(sessionId)
    if (!sessionRecord) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const processed = fromMe ? true : msg.processed

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
        fromMe,
        processed,
        location: msg.location,
        interactive: msg.interactive,
        interactiveReply: msg.interactiveReply,
      },
    })

    if (created) {
      return {
        created: true,
        id: messageRecord.messageId,
      }
    }

    let currentRecord = messageRecord

    if (currentRecord.chatSessionId === null) {
      // The inbound row is pre-persisted with chatSessionId=null before the chatbot
      // runs; the null-guarded WHERE ensures only one concurrent caller wins adoption.
      const [adopted] = await WhatsappMessageRecord.update(
        {
          chatId: sessionRecord.chatId,
          chatSessionId: sessionId,
          created_at: msg.created_at,
          type: msg.type,
          body: msg.msg,
          processed: currentRecord.processed || processed,
          location: msg.location,
          interactive: msg.interactive,
          interactiveReply: msg.interactiveReply,
        },
        {
          where: {
            wpClientId: sessionRecord.wpClientId,
            messageId: msg.id,
            chatSessionId: null,
          },
        }
      )

      if (adopted === 1) {
        return {
          created: true,
          id: currentRecord.messageId,
        }
      }

      const refetched = await WhatsappMessageRecord.findOne({
        where: {
          wpClientId: sessionRecord.wpClientId,
          messageId: msg.id,
        },
      })

      if (!refetched) {
        throw new Error(`Message ${msg.id} not found after concurrent adoption`)
      }

      currentRecord = refetched
    }

    if (currentRecord.chatSessionId !== sessionId) {
      console.warn(
        '[SessionAddMsgCrossSessionDuplicate]',
        JSON.stringify({
          wpClientId: sessionRecord.wpClientId,
          messageId: msg.id,
          owningSessionId: currentRecord.chatSessionId,
          callingSessionId: sessionId,
          at: new Date().toISOString(),
        })
      )
      return {
        created: false,
        id: currentRecord.messageId,
      }
    }

    currentRecord.chatId = sessionRecord.chatId
    currentRecord.chatSessionId = sessionId
    currentRecord.created_at = msg.created_at
    currentRecord.type = msg.type
    currentRecord.body = msg.msg
    currentRecord.processed = currentRecord.processed || processed
    currentRecord.location = msg.location
    currentRecord.interactive = msg.interactive
    currentRecord.interactiveReply = msg.interactiveReply
    await currentRecord.save()

    return {
      created: false,
      id: currentRecord.messageId,
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
      { processed: true },
      {
        where: {
          wpClientId: sessionRecord.wpClientId,
          chatSessionId: sessionId,
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
