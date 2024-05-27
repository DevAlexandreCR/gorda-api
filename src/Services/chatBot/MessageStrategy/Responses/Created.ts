import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import { AskingForPlace } from './AskingForPlace'
import { WpMessage } from '../../../../Types/WpMessage'
import { NotificationType } from '../../../../Types/NotificationType'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

export class Created extends ResponseContract {
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.LOCATION]

  public async processMessage(message: WpMessage): Promise<void> {
    if (this.clientExists(this.session.chat_id)) await this.validateKey(message)
    else {
      if (this.isLocation(message) && message.location) {
        const place = this.getPlaceFromLocation(message.location)
        await this.session.setPlace(place)
      }
      await this.session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ASK_FOR_NAME))
    }
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
