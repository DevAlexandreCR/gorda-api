import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpContactAdapter } from './WpContactAdapter'
import { OfficialClient } from '../OfficialClient'
import { Store } from '../../../../../Services/store/Store'
import { ClientInterface } from '../../../../../Interfaces/ClientInterface'
import config from '../../../../../../config'
import { ChatBotMessage } from '../../../../../Types/ChatBotMessage'

export class WpChatAdapter implements WpChatInterface {
  archived: boolean = false
  store: Store

  constructor(
    private client: OfficialClient,
    public id: string
  ) {
    this.store = Store.getInstance()
  }

  sendMessage(message: ChatBotMessage): Promise<void> {
    return this.client.sendMessage(this.id, message)
  }

  archive(): Promise<void> {
    this.archived = true
    return Promise.resolve()
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
