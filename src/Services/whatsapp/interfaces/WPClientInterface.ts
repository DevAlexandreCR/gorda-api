import { WpEvents } from '../constants/WpEvents'
import { WpStates } from '../constants/WpStates'
import { WpChatInterface } from './WpChatInterface'
import { WpClients } from '../constants/WPClients'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'

export interface WPClientInterface {
  serviceName: WpClients

  sendMessage(phoneNumber: string, message: ChatBotMessage): Promise<void>

  sendTypingIndicator(chatId: string, inboundMessageId: string): Promise<void>

  on(event: WpEvents, callback: (...arg: any) => void): void

  removeAllListeners(): void

  getWWebVersion(): Promise<string>

  getState(): Promise<WpStates>

  getChatById(chatId: string): Promise<WpChatInterface>

  logout(): Promise<void>

  initialize(): Promise<void>

  getInfo(): string
}
