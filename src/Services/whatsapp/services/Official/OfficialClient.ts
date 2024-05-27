import { WpEvents } from '../../constants/WpEvents'
import { WpStates } from '../../constants/WpStates'
import { WPClientInterface } from '../../interfaces/WPClientInterface'
import { WpChatInterface } from '../../interfaces/WpChatInterface'
import { WpMessageInterface } from '../../interfaces/WpMessageInterface'

export class OfficialClient implements WPClientInterface {
  getInfo(): string {
    throw new Error('Method not implemented.')
  }
  info: string
  getWWebVersion(): Promise<string> {
    throw new Error('Method not implemented.')
  }
  initialize(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  build(): this {
    throw new Error('Method not implemented.')
  }
  sendMessage(phoneNumber: string, message: string): Promise<void> {
    throw new Error('Method not implemented.')
  }
  receiveMessage(phoneNumber: string): string {
    throw new Error('Method not implemented.')
  }
  on(event: WpEvents, callback: (...args: any) => void): void {
    throw new Error('Method not implemented.')
  }
  getState(): Promise<WpStates> {
    throw new Error('Method not implemented.')
  }
  getChatById(chatId: string): Promise<WpChatInterface> {
    throw new Error('Method not implemented.')
  }
  logout(): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
