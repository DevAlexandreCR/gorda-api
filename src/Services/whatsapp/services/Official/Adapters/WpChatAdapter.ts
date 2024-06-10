import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpContactAdapter } from './WpContactAdapter'
import { OfficialClient } from '../OfficialClient'
import { Store } from '../../../../../Services/store/Store'

export class WpChatAdapter implements WpChatInterface {
  archived: boolean = false
  store: Store

  constructor(private client: OfficialClient, public id: string) {
    this.store = Store.getInstance()
  }

  sendMessage(message: string): Promise<void> {
    return this.client.sendMessage(this.id, message)
  }

  archive(): Promise<void> {
    this.archived = true
    return Promise.resolve()
  }

  getContact(): Promise<WpContactInterface> {
    const contact = this.store.clients.get(this.id)
    if (contact) {
      return Promise.resolve(new WpContactAdapter(contact))
    } else {
      throw new Error('Contact not found')
    }
  }
}
