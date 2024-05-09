import {Contact, MessageTypes} from 'whatsapp-web.js'
import {ResponseContract} from '../ResponseContract'
import MessageHelper from '../../../../Helpers/MessageHelper'
import ClientRepository from '../../../../Repositories/ClientRepository'
import * as Messages from '../../Messages'
import * as Sentry from '@sentry/node'
import {WpMessage} from '../../../../Types/WpMessage'
import EntityExtractor from '../../ai/EntityExtractor'
import Session from '../../../../Models/Session'
import {AskingForPlace} from './AskingForPlace'

export class AskingForName extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(message: WpMessage): Promise<void> {
    if (this.isChat(message)) {
      const name = await this.retryPromise<string|false>(EntityExtractor.extractName(message.msg), 3)
      if (name) {
        await this.createClient(message.id, name)
        if(!this.session.place) {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
          await this.sendMessage(Messages.greetingNews(this.currentClient.name))
        } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME) {
          await this.sendMessage(Messages.newClientAskPlaceName(name))
          await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
        } else {
          await this.sendMessage(Messages.newClientAskForComment(name, this.session.place.name)).then(async () => {
            await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
          })
        }
      } else {
        await this.sendMessage(Messages.ASK_FOR_NAME)
      }
    } else {
      await this.sendMessage(Messages.MESSAGE_TYPE_NOT_SUPPORTED)
    }
  }
  
  private async createClient(messageId: string, name: string): Promise<void> {
    const contact = await this.getContact()
    contact.name = MessageHelper.normalizeName(name)
    this.currentClient = await ClientRepository.create(contact)
  }
  
  async getContact(): Promise<Contact> {
    return new Promise((resolve) => {
      this.session.chat.getContact()
        .then(contact => {
          resolve(contact)
        })
        .catch(e => Sentry.captureException(e))
    })
  }
}