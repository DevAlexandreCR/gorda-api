import { WpEvents } from '../constants/WpEvents'
import { WpStates } from '../constants/WpStates'
import { WpChatInterface } from './WpChatInterface'
import { WpMessageInterface } from './WpMessageInterface'

export interface WPClientInterface {
  sendMessage(phoneNumber: string, message: string): Promise<void>

  on(event: WpEvents, callback: (...arg: any) => void): void

  getWWebVersion(): Promise<string>

  getState(): Promise<WpStates>

  getChatById(chatId: string): Promise<WpChatInterface>

  logout(): Promise<void>

  initialize(): Promise<void>

  getInfo(): string
}
