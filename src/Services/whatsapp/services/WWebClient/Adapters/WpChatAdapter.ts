import { Chat } from 'whatsapp-web.js'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpContactAdapter } from './WpContactAdapter'
import { ChatBotMessage } from '../../../../../Types/ChatBotMessage'

export class WpChatAdapter implements WpChatInterface {
  id: string
  archived: boolean

  constructor(private chat: Chat) {
    this.id = chat.id._serialized
  }

  async sendMessage(message: ChatBotMessage): Promise<void> {
    await this.chat.sendMessage(message.message)

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
