import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WASocket } from '@whiskeysockets/baileys'
import { WpContactAdapter } from './WpContactAdapter'
import { Store } from '../../../../../Services/store/Store'
import config from '../../../../../../config'
import { ClientInterface } from '../../../../../Interfaces/ClientInterface'
import { ChatBotMessage } from '../../../../../Types/ChatBotMessage'

export class WpChatAdapter implements WpChatInterface {
  archived: boolean = false
  store: Store

  constructor(
    private waSocket: WASocket,
    public id: string
  ) {
    this.store = Store.getInstance()
  }

  async sendMessage(message: ChatBotMessage): Promise<void> {
    await this.waSocket.sendMessage(this.id, { text: message.message })
    return Promise.resolve()
  }

  async archive(): Promise<void> {
    await this.waSocket.chatModify(
      {
        lastMessages: [],
        archive: true,
      },
      this.id
    )
    this.archived = true
  }

  async getContact(): Promise<WpContactInterface> {
    const contact = this.store.clients.get(this.id)
    if (!contact) {
      return Promise.resolve(
        new WpContactAdapter({
          id: this.id,
          name: 'Usuario',
          phone: this.id.replace('@c.us', ''),
          photoUrl: config.DEFAULT_CLIENT_PHOTO_URL,
        } as ClientInterface)
      )
    } else {
      return Promise.resolve(new WpContactAdapter(contact))
    }
  }
}
