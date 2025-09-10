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
import { GordaChatBot } from '../../../../Services/chatBot/ai/Services/GordaChatBot'
import { MessageHandler } from '../../../chatBot/ai/MessageHandler'
import { ChatBotMessage } from '../../../../Types/ChatBotMessage'

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
      const ia = new MessageHandler(new GordaChatBot())

      const response = await ia.handleMessage(message.msg)

      let msg: ChatBotMessage

      if (response.session_status == Session.STATUS_CREATED) {
        msg = Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE)
        msg.message = response.message.body
      } else {
        await this.createClient(message.id, response.name || 'Usuario')
        msg = Messages.greeting(this.currentClient.name)
        msg.message = response.message.body
        if (message.interactive && message.interactive.body) {
          message.interactive.body.text = response.message.body
        }
      }

      await this.sendMessage(msg)
      await this.session.setStatus(response.session_status)
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
      if (!this.session.notifications.greeting) {
        await this.sendMessage(Messages.greeting(this.currentClient.name)).then(async () => {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
          await this.session.setNotification(NotificationType.greeting)
        })
      }
    }
  }
}
