import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import {WpMessage} from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'
import {MessagesEnum} from '../../MessagesEnum'

export class AskingForPlace extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.LOCATION]

  public async processMessage(message: WpMessage): Promise<void> {
    if(!this.session.place) {
      if (this.isLocation(message) && message.location) {
        const place = this.getPlaceFromLocation(message.location)
        if (place.name !== MessageHelper.LOCATION_NO_NAME) {
          const msg = Messages.requestingService(place.name)
          if (msg.enabled) {
            await this.sendMessage(msg.message).then(async () => {
              await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
              await this.session.setPlace(place)
            })
          } else {
            await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          }
        } else {
          const msg = Messages.getSingleMessage(MessagesEnum.ASK_FOR_LOCATION_NAME)
          if (msg.enabled) {
            await this.sendMessage(msg.message).then(async () => {
              await this.session.setPlace(place)
            })
          }
        }
      } else {
        const msg = Messages.getSingleMessage(MessagesEnum.NO_LOCATION_FOUND)
        if (msg.enabled) {
          await this.sendMessage(msg.message)
        }
      }
    } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME && this.isChat(message)) {
      const name = MessageHelper.normalize(message.msg)
      if (name.length > 3 && MessageHelper.isPlaceName(name)) {
        const place = this.session.place
        place.name = name
        const msg = Messages.requestingService(place.name)
        if (msg.enabled) {
          await this.sendMessage(msg.message).then(async () => {
            await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          })
        } else {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
          await this.session.setPlace(place)
        }
      } else {
        const msg = Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND)
        if (msg.enabled) {
          await this.sendMessage(msg.message)
        }
      }
    }
  }
}