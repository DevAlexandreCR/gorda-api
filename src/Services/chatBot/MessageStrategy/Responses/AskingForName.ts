import {Contact, MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import MessageHelper from '../../../../Helpers/MessageHelper'
import ClientRepository from '../../../../Repositories/ClientRepository'
import * as Messages from '../../Messages'
import * as Sentry from '@sentry/node'
import {WpMessage} from '../../../../Types/WpMessage'

export class AskingForName extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(message: WpMessage): Promise<void> {
    if (this.isChat(message)) {
      await this.createClient(message)
      await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      await this.sendMessage(Messages.welcomeNews(this.currentClient.name))
    } else {
      await this.sendMessage(Messages.MESSAGE_TYPE_NOT_SUPPORTED)
    }
  }
  
  private async createClient(message: WpMessage): Promise<void> {
    const contact = await this.getContact(message)
    contact.name = MessageHelper.normalizeName(message.msg)
    this.currentClient = await ClientRepository.create(contact)
  }
  
  async getContact(message: WpMessage): Promise<Contact> {
    const wpMessage = await this.session.wpClient.getMessageById(message.id)
    return new Promise((resolve) => {
      wpMessage.getContact()
        .then(contact => {
          resolve(contact)
        })
        .catch(e => Sentry.captureException(e))
    })
  }
}