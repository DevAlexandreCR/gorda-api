import { Op } from 'sequelize'
import { Chat } from '../Interfaces/Chat'
import { Message } from '../Interfaces/Message'
import DateHelper from '../Helpers/DateHelper'
import ChatIdHelper from '../Helpers/ChatIdHelper'
import WhatsappChatRecord from '../Models/WhatsappChatRecord'
import ChatSessionRecord from '../Models/ChatSessionRecord'
import Session from '../Models/Session'
import ChatRealtimeGateway from '../Services/whatsapp/ChatRealtimeGateway'
import { SessionInterface } from '../Interfaces/SessionInterface'
import { ActiveChatSessionSummary } from '../Interfaces/ActiveChatSessionSummary'

class ChatRepository {
  public getChats(wpClientId: string, listener: (chats: Chat[]) => void): void {
    void this.listChats(wpClientId)
      .then((chats) => listener(chats))
      .catch((error) => console.log(error.message))
  }

  public async listChats(wpClientId: string, limit: number = 100): Promise<Chat[]> {
    const chatRecords = await WhatsappChatRecord.findAll({
      where: { wpClientId },
      order: [['updated_at', 'DESC']],
      limit,
    })

    const activeSessions = await ChatSessionRecord.findAll({
      where: {
        wpClientId,
        status: {
          [Op.notIn]: [Session.STATUS_COMPLETED],
        },
      },
      order: [['created_at', 'DESC']],
    })

    const sessionByChatId = new Map<string, ActiveChatSessionSummary>()
    activeSessions.forEach((sessionRecord) => {
      const chatId = ChatIdHelper.normalize(sessionRecord.chatId)
      if (!sessionByChatId.has(chatId)) {
        sessionByChatId.set(chatId, this.mapActiveSessionSummary(sessionRecord))
      }
    })

    return chatRecords.map((chatRecord) =>
      this.mapChat(chatRecord, sessionByChatId.get(chatRecord.chatId))
    )
  }

  public async findChat(wpClientId: string, chatId: string): Promise<Chat | null> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const chatRecord = await WhatsappChatRecord.findOne({
      where: {
        wpClientId,
        chatId: normalizedChatId,
      },
    })

    if (!chatRecord) return null

    const activeSession = await ChatSessionRecord.findOne({
      where: {
        wpClientId,
        chatId: normalizedChatId,
        status: {
          [Op.notIn]: [Session.STATUS_COMPLETED],
        },
      },
      order: [['created_at', 'DESC']],
    })

    return this.mapChat(
      chatRecord,
      activeSession ? this.mapActiveSessionSummary(activeSession) : undefined
    )
  }

  public async updateChat(
    wpClientId: string,
    chatId: string,
    data: Partial<Chat>
  ): Promise<Chat | null> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const chatRecord = await WhatsappChatRecord.findOne({
      where: {
        wpClientId,
        chatId: normalizedChatId,
      },
    })

    if (!chatRecord) return null

    if (typeof data.archived === 'boolean') {
      chatRecord.archived = data.archived
    }

    if (data.clientName) {
      chatRecord.clientName = data.clientName
    }

    if (data.lastMessage) {
      chatRecord.lastMessage = data.lastMessage
    }

    if (typeof data.updated_at === 'number') {
      chatRecord.updated_at = data.updated_at
    }

    await chatRecord.save()
    return this.emitAdminChat(wpClientId, normalizedChatId)
  }

  public async updateChatWithMessage(
    wpClientId: string,
    chatId: string,
    message: Message,
    clientName: string = `Chat ${ChatIdHelper.normalize(chatId)}`
  ): Promise<Chat> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const chatTimestamp =
      typeof message.created_at === 'number' && message.created_at > 0
        ? message.created_at
        : DateHelper.unix()

    const [chatRecord] = await WhatsappChatRecord.findOrCreate({
      where: {
        wpClientId,
        chatId: normalizedChatId,
      },
      defaults: {
        wpClientId,
        chatId: normalizedChatId,
        clientName,
        archived: false,
        lastMessage: message,
        created_at: chatTimestamp,
        updated_at: chatTimestamp,
      },
    })

    chatRecord.clientName = clientName || chatRecord.clientName
    chatRecord.lastMessage = message
    chatRecord.archived = false
    chatRecord.updated_at = chatTimestamp
    await chatRecord.save()

    const chat = await this.emitAdminChat(wpClientId, normalizedChatId)

    if (!chat) {
      throw new Error(`Chat ${normalizedChatId} not found after update`)
    }

    return chat
  }

  public async addChat(wpClientId: string, chat: Chat): Promise<Chat> {
    const normalizedChatId = ChatIdHelper.normalize(chat.id)
    const [chatRecord] = await WhatsappChatRecord.findOrCreate({
      where: {
        wpClientId,
        chatId: normalizedChatId,
      },
      defaults: {
        wpClientId,
        chatId: normalizedChatId,
        clientName: chat.clientName,
        archived: chat.archived,
        lastMessage: chat.lastMessage,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
      },
    })

    if (!chatRecord.clientName && chat.clientName) {
      chatRecord.clientName = chat.clientName
      await chatRecord.save()
    }

    const storedChat = await this.findChat(wpClientId, normalizedChatId)

    if (!storedChat) {
      throw new Error(`Chat ${normalizedChatId} was not created`)
    }

    return storedChat
  }

  public async emitAdminChat(wpClientId: string, chatId: string): Promise<Chat | null> {
    const chat = await this.findChat(wpClientId, chatId)

    if (chat) {
      ChatRealtimeGateway.emitChatUpsert(wpClientId, chat)
    }

    return chat
  }

  private mapChat(record: WhatsappChatRecord, activeSession?: ActiveChatSessionSummary): Chat {
    return {
      id: record.chatId,
      created_at: Number(record.created_at),
      updated_at: Number(record.updated_at),
      archived: Boolean(record.archived),
      clientName: record.clientName,
      lastMessage: record.lastMessage as Message,
      activeSession,
    }
  }

  private mapActiveSessionSummary(record: ChatSessionRecord): ActiveChatSessionSummary {
    return {
      sessionId: record.id,
      status: record.status,
      service_id: record.service_id,
      notifications: record.notifications,
      place: record.place,
      placeOptions: record.placeOptions ?? [],
    }
  }
}

export default new ChatRepository()
