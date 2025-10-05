import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import { AskingForPlace } from './AskingForPlace'
import { WpMessage } from '../../../../Types/WpMessage'
import { NotificationType } from '../../../../Types/NotificationType'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import MessageHelper from '../../../../Helpers/MessageHelper'
import ClientRepository from '../../../../Repositories/ClientRepository'
import { WpContactInterface } from '../../../../Services/whatsapp/interfaces/WpContactInterface'
import { MessageHandler } from '../../ai/MessageHandler'
import { GordaChatBot } from '../../ai/Services/GordaChatBot'
import { SessionStatuses } from '../../../../Types/SessionStatuses'

export class Created extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.LOCATION,
    MessageTypes.INTERACTIVE,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    if (this.clientExists(this.session.chat_id)) await this.validateKey(message)
    else {
      if (this.isLocation(message) && message.location) {
        const place = await this.getPlaceFromLocation(message.location)
        if (!place) return
        await this.session.setPlace(place)
      }
      await this.session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ASK_FOR_NAME))
    }
  }

  private async createClient(messageId: string, name: string): Promise<void> {
    const contact = await this.getContact()
    contact.pushname = MessageHelper.normalizeName(name)
    this.currentClient = await ClientRepository.create(contact)
  }

  async getContact(): Promise<WpContactInterface> {
    return new Promise((resolve, reject) => {
      this.session.chat
        .getContact()
        .then((contact) => {
          resolve(contact)
        })
        .catch((e) => {
          console.log('Error getting contact', e)
          reject(e)
        })
    })
  }

  async validateKey(message: WpMessage): Promise<void> {
    if (this.isLocation(message)) {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      const response = new AskingForPlace(this.session)
      await response.processMessage(message)
    } else {
      const ia = new MessageHandler(new GordaChatBot())
      const response = await ia.handleMessage(message.msg, SessionStatuses.ASKING_FOR_PLACE)
      if (response.place) {
        const place = await this.store.findPlaceByName(response.place)
        if (place) {
          await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
            await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          })
        }
      } else if (response.sessionStatus === SessionStatuses.SUPPORT) {
        await this.session.setStatus(SessionStatuses.SUPPORT)
        await this.sendAIMessage(MessagesEnum.DEFAULT_MESSAGE, response.message.body)
      } else if (!this.session.notifications.greeting) {
        await this.sendMessage(Messages.greeting(this.currentClient.name)).then(async () => {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
          await this.session.setNotification(NotificationType.greeting)
        })
      }
    }
  }
}
