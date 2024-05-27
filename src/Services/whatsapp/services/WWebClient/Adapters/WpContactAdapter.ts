import { Contact } from 'whatsapp-web.js'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: { _serialized: string }
  name: string
  phoneNumber: string
  email?: string | undefined

  constructor(private contact: Contact) {
    this.pushname = contact.pushname
    this.number = contact.number
    this.id = contact.id
    this.name = contact.name ?? 'User'
    this.phoneNumber = contact.number
    this.email = contact.id.user
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return this.contact.getProfilePicUrl()
  }
}
