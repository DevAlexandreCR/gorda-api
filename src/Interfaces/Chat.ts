import { Message } from './Message'
import { ActiveChatSessionSummary } from './ActiveChatSessionSummary'

export type Chat = {
  id: string
  created_at: number
  updated_at: number
  archived: boolean
  clientName: string
  lastMessage: Message
  activeSession?: ActiveChatSessionSummary
}
