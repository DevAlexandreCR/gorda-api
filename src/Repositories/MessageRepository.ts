import { Message } from '../Interfaces/Message'
import ChatIdHelper from '../Helpers/ChatIdHelper'
import WhatsappMessageRecord from '../Models/WhatsappMessageRecord'
import ChatRepository from './ChatRepository'
import ChatRealtimeGateway from '../Services/whatsapp/ChatRealtimeGateway'

type AddMessageOptions = {
  chatSessionId?: string | null
  clientName?: string
  processed?: boolean
}

class MessageRepository {
  public getMessages(
    wpClientId: string,
    chatId: string,
    listener: (messages: Message[]) => void
  ): void {
    void this.listMessages(wpClientId, chatId)
      .then((messages) => listener(messages))
      .catch((error) => console.log(error.message))
  }

  public async listMessages(wpClientId: string, chatId: string, limit = 50): Promise<Message[]> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const messageRecords = await WhatsappMessageRecord.findAll({
      where: {
        wpClientId,
        chatId: normalizedChatId,
      },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    })

    return messageRecords.reverse().map((record) => this.mapMessage(record))
  }

  public async addMessage(
    wpClientId: string,
    chatId: string,
    message: Message,
    options: AddMessageOptions = {}
  ): Promise<Message> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const [messageRecord] = await WhatsappMessageRecord.findOrCreate({
      where: {
        wpClientId,
        messageId: message.id,
      },
      defaults: {
        wpClientId,
        chatId: normalizedChatId,
        chatSessionId: options.chatSessionId ?? null,
        messageId: message.id,
        created_at: message.created_at,
        type: message.type,
        body: message.body,
        fromMe: message.fromMe,
        processed: options.processed ?? message.fromMe,
        location: message.location ?? null,
        interactive: message.interactive ?? null,
        interactiveReply: message.interactiveReply ?? null,
      },
    })

    messageRecord.chatId = normalizedChatId
    if (options.chatSessionId !== undefined) {
      messageRecord.chatSessionId = options.chatSessionId
    }
    messageRecord.created_at = message.created_at
    messageRecord.type = message.type
    messageRecord.body = message.body
    messageRecord.fromMe = message.fromMe
    messageRecord.location = message.location ?? null
    messageRecord.interactive = message.interactive ?? null
    messageRecord.interactiveReply = message.interactiveReply ?? null

    if (typeof options.processed === 'boolean') {
      messageRecord.processed = options.processed
    }

    await messageRecord.save()

    const storedMessage = this.mapMessage(messageRecord)
    await ChatRepository.updateChatWithMessage(
      wpClientId,
      normalizedChatId,
      storedMessage,
      options.clientName
    )
    ChatRealtimeGateway.emitMessageCreated(wpClientId, normalizedChatId, storedMessage)

    return storedMessage
  }

  private mapMessage(record: WhatsappMessageRecord): Message {
    return {
      id: record.messageId,
      created_at: Number(record.created_at),
      type: record.type,
      body: record.body,
      fromMe: Boolean(record.fromMe),
      location: record.location ?? null,
      interactive: record.interactive ?? null,
      interactiveReply: record.interactiveReply ?? null,
    }
  }
}

export default new MessageRepository()
