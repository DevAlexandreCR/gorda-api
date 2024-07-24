import { WpContactInterface } from '../../../interfaces/WpContactInterface'
import { ClientInterface } from '../../../../../Interfaces/ClientInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: string

  constructor(private contact: ClientInterface) {
    this.pushname = contact.name
    this.number = contact.phone
    this.id = contact.id
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return this.contact.photoUrl as string
  }
}
