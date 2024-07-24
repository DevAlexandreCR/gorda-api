import { Contact } from 'whatsapp-web.js'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: string

  constructor(private contact: Contact) {
    this.pushname = contact.pushname
    this.number = contact.number
    this.id = contact.id._serialized
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return this.contact.getProfilePicUrl()
  }
}
