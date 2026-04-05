import { Message } from './Message'

export interface WhatsappChatRecordInterface {
  id?: number
  wpClientId: string
  chatId: string
  clientName: string
  archived: boolean
  lastMessage: Message
  created_at: number
  updated_at: number
}
