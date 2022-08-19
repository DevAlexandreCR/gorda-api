import {Client, Contact, Message, MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import MessageHelper from '../../../../Helpers/MessageHelper'
import ClientRepository from '../../../../Repositories/ClientRepository'
import * as Messages from '../../Messages'

export class AskingForName extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    if (this.isChat(message)) {
      await this.createClient(message)
      await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      await this.sendMessage(client, message.from, Messages.welcomeNews(this.currentClient.name))
    } else {
      await this.sendMessage(client, message.from, Messages.MESSAGE_TYPE_NOT_SUPPORTED)
    }
  }
  
  private async createClient(message: Message): Promise<void> {
    const contact = await this.getContact(message)
    contact.name = MessageHelper.normalizeName(message.body)
    this.currentClient = await ClientRepository.create(contact)
  }
  
  async getContact(message: Message): Promise<Contact> {
    return new Promise((resolve) => {
      message.getContact()
        .then(contact => {
          resolve(contact)
        })
        .catch(e => {
          console.log(e)
        })
    })
  }
}