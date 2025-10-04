import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { log } from 'console'

export class AskingForComment extends ResponseContract {
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.INTERACTIVE]

  public async processMessage(message: WpMessage): Promise<void> {
    this.setCurrentClient(this.session.chat_id)
    let comment = ''
    if (this.hasComment(message)) {
      comment = this.hasComment(message).toString()
    }

    const place = this.session.place

    if (place) {
      await this.createService(place, comment).then(async () => {
        await this.session.setStatus(Session.STATUS_REQUESTING_SERVICE)
      })
    } else {
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ERROR_CREATING_SERVICE))
      await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
    }
  }

  hasComment(message: WpMessage): false | string {
    let msg = ''

    log('Message received in AskingForComment:', message)
    if (message.type === MessageTypes.INTERACTIVE && message.interactiveReply) {
      if (message.interactiveReply.button_reply) {
        msg = message.interactiveReply.button_reply.id
      } else if (message.interactiveReply.list_reply) {
        msg = message.interactiveReply.list_reply.id
      }
    } else {
      msg = message.msg
    }

    return msg.length >= 2 ? msg : false
  }
}
