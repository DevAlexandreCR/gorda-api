import {Message} from './Message'

export type Chat = {
  id: string
  created_at: number
  updated_at: number
  archived: boolean
  clientName: string
  lastMessage: Message
}
