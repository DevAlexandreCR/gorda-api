import { Chat } from 'whatsapp-web.js'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpContactAdapter } from './WpContactAdapter'

export class WpChatAdapter implements WpChatInterface {
  id: string
  archived: boolean

  constructor(private chat: Chat) {
    this.id = chat.id._serialized
  }

  async sendMessage(message: string): Promise<void> {
    await this.chat.sendMessage(message)

    return Promise.resolve()
  }

  async archive(): Promise<void> {
    this.archived = true
    return this.chat.archive()
  }

  async getContact(): Promise<WpContactInterface> {
    const contact = await this.chat.getContact()

    return new WpContactAdapter(contact)
  }
}
