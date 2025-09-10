import Session from '../../../../Models/Session'
import { ResponseContract } from '../ResponseContract'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

export class AskingForPlace extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.LOCATION,
    MessageTypes.INTERACTIVE,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    if (!this.session.place) {
      if (this.isLocation(message) && message.location) {
        const place = await this.getPlaceFromLocation(message.location)
        if (!place) return
        if (place.name !== MessageHelper.LOCATION_NO_NAME) {
          await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
            await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          })
        } else {
          await this.sendMessage(
            Messages.getSingleMessage(MessagesEnum.ASK_FOR_LOCATION_NAME)
          ).then(async () => {
            await this.session.setPlace(place)
          })
        }
      } else {
        await this.sendMessage(Messages.getSingleMessage(MessagesEnum.NO_LOCATION_FOUND))
      }
    } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME && this.isChat(message)) {
      const name = MessageHelper.normalize(message.msg)
      if (name.length > 3 && MessageHelper.isPlaceName(name)) {
        const place = this.session.place
        place.name = name
        await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
          await this.session.setPlace(place)
        })
      } else {
        await this.sendMessage(Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND))
      }
    } else {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
      this.session.processMessage(message, [])
    }
  }
}
