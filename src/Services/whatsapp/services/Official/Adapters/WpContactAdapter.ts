import { ClientInterface } from '../../../../../Interfaces/ClientInterface'
import { WpContactInterface } from '../../../interfaces/WpContactInterface'

export class WpContactAdapter implements WpContactInterface {
  pushname: string
  number: any
  id: string
  photoUrl: string

  constructor(contact: ClientInterface) {
    this.pushname = contact.name
    this.number = contact.phone
    this.id = contact.id
    this.photoUrl = contact.photoUrl
  }

  getProfilePicUrl(): string | PromiseLike<string> {
    return Promise.resolve(this.photoUrl)
  }
}
