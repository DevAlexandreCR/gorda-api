import { WpContactInterface } from './WpContactInterface'

export interface WpChatInterface {
  id: string
  archived: boolean

  sendMessage(message: string): Promise<void>

  archive(): Promise<void>

  getContact(): Promise<WpContactInterface>
}
