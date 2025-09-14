import { ResponseContract } from '../ResponseContract'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { MessageHandler } from '../../ai/MessageHandler'
import { GordaChatBot } from '../../ai/Services/GordaChatBot'

export class AskingForPlace extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.LOCATION,
    MessageTypes.INTERACTIVE,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    const ia = new MessageHandler(new GordaChatBot())
    if (!this.session.place) {
      if (this.isLocation(message) && message.location) {
        const place = await this.getPlaceFromLocation(message.location)
        if (!place) return
        if (place.name !== MessageHelper.LOCATION_NO_NAME) {
          await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
            await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
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
        const response = await ia.handleMessage(message.msg, SessionStatuses.ASKING_FOR_PLACE)
        if (response.place) {
          const place = this.store.findPlaceByName(response.place)
          if (place) {
            await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
              await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
              await this.session.setPlace(place)
            })
          } else {
            const msg = Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND)
            await this.sendMessage(msg)
          }
        }
      }
    } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME && this.isChat(message)) {
      const response = await ia.handleMessage(message.msg, SessionStatuses.ASKING_FOR_PLACE)
      if (response.place) {
        const place = this.store.findPlaceByName(response.place)
        if (place) {
          await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
            await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          })
        } else {
          const msg = Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE)
          msg.message = response.message.body
          await this.sendMessage(msg)
        }
      }
    } else {
      await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
      this.session.processMessage(message, [])
    }
  }
}
