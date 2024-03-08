import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import {sendPlaceOptions} from '../../Messages'
import Place from '../../../../Models/Place'
import {PlaceOption} from '../../../../Interfaces/PlaceOption'
import {WpMessage} from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'

export class AskingForPlace extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.LOCATION]
  
  public async processMessage(message: WpMessage): Promise<void> {
    if(!this.session.place) {
      if (this.isLocation(message) && message.location) {
        const place = this.getPlaceFromLocation(message.location)
        if (place.name !== MessageHelper.LOCATION_NO_NAME) {
          await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
            await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
            await this.session.setPlace(place)
          })
        } else {
          await this.sendMessage(Messages.ASK_FOR_LOCATION_NAME).then(async () => {
            await this.session.setPlace(place)
          })
        }
      } else {
        await this.sendMessage(Messages.NO_LOCATION_FOUND)
      }
    } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME && this.isChat(message)) {
      const place = this.session.place
      place.name = message.msg
      await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
        await this.session.setPlace(place)
      })
    }
  }
}