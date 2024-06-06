import { Contact, WAContactMessage, WAPresence, proto } from '@whiskeysockets/baileys'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: { _serialized: string }

  constructor(private contact: Contact) {
    this.pushname = contact.name as string
    this.number = contact.lid as string
    this.id = { _serialized: contact.lid as string }
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return this.contact.imgUrl as string
  }
}
