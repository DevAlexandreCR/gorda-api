import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WASocket } from '@whiskeysockets/baileys'
import { WpContactAdapter } from './WpContactAdapter'
import { Store } from '../../../../../Services/store/Store'

export class WpChatAdapter implements WpChatInterface {
  archived: boolean = false
  store: Store

  constructor(private waSocket: WASocket, public id: string) {
    this.store = Store.getInstance()
  }

  async sendMessage(message: string): Promise<void> {
    await this.waSocket.sendMessage(this.id, { text: message })
    return Promise.resolve()
  }

  async archive(): Promise<void> {
    await this.waSocket.chatModify(
      {
        lastMessages: [],
        archive: true,
      },
      this.id,
    )
    this.archived = true
  }

  async getContact(): Promise<WpContactInterface> {
    const contact = this.store.clients.get(this.id)
    if (contact) {
      return Promise.resolve(new WpContactAdapter(contact))
    } else {
      throw new Error('Contact not found')
    }
  }
}
