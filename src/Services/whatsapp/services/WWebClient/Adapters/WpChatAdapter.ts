import { Chat } from 'whatsapp-web.js'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WpMessageAdapter } from './WpMessageAdapter'
import { WpContactAdapter } from './WpContactAdapter'

export class WpChatAdapter implements WpChatInterface {
  constructor(private chat: Chat) {}

  async sendMessage(message: string): Promise<WpMessageInterface> {
    const msg = await this.chat.sendMessage(message)

    return new WpMessageAdapter(msg)
  }

  async archive(): Promise<void> {
    return this.chat.archive()
  }

  async getContact(): Promise<WpContactInterface> {
    const contact = await this.chat.getContact()

    return new WpContactAdapter(contact)
  }
}
