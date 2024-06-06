import { Contact, WAContactMessage, WAPresence, proto } from '@whiskeysockets/baileys'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: { _serialized: string }

  constructor(private contact: Contact) {
    this.pushname = contact.name as string
    this.number = this.extractPhoneNumber(contact.lid as string)
    this.id = { _serialized: this.modifyPhoneNumber(contact.lid as string) }
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return this.contact.imgUrl as string
  }

  private extractPhoneNumber(input: string): string | null {
    return input.replace(/@.*$/, '')
  }

  private modifyPhoneNumber(phoneNumber: string): string {
    return phoneNumber.replace(/@.*$/, '@c.us')
  }
}
