import { ChatBotMessage } from '../../../Types/ChatBotMessage'
import { WpContactInterface } from './WpContactInterface'

export interface WpChatInterface {
  id: string
  archived: boolean

  sendMessage(message: ChatBotMessage): Promise<void>

  archive(): Promise<void>

  getContact(): Promise<WpContactInterface>
}
