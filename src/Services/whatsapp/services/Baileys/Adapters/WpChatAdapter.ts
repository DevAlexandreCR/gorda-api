import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { Contact, WASocket, proto } from '@whiskeysockets/baileys'
import { WpMessageAdapter } from './WPMessageAdapter'
import { WpContactAdapter } from './WpContactAdapter'

export class WpChatAdapter implements WpChatInterface {
  constructor(private waSocket: WASocket, private chatId: string) {}

  async sendMessage(message: string): Promise<WpMessageInterface> {
    const msg = await this.waSocket.sendMessage(this.chatId, { text: message })

    return new WpMessageAdapter(msg!, this.waSocket)
  }

  async archive(): Promise<void> {
    await this.waSocket.chatModify(
      {
        lastMessages: [],
        archive: true,
      },
      this.chatId,
    )
  }

  async getContact(): Promise<WpContactInterface> {
    const contactId = this.chatId.split('@')[0]
    const contact = await this.waSocket.onWhatsApp(contactId)
    if (contact && contact.length > 0) {
      return new WpContactAdapter({
        name: 'User',
        lid: contact[0].jid,
        imgUrl: '',
      } as Contact)
    } else {
      throw new Error('Contact not found')
    }
  }
}
