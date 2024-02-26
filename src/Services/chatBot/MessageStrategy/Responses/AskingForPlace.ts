import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import {sendPlaceOptions} from '../../Messages'
import Place from '../../../../Models/Place'
import {PlaceOption} from '../../../../Interfaces/PlaceOption'
import {WpMessage} from '../../../../Types/WpMessage'

export class AskingForPlace extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.LOCATION]
  
  public async processMessage(message: WpMessage): Promise<void> {
    let places: Array<Place> = []
    if (this.isChat(message)) {
      places = this.getPlaceFromMessage(message.msg)
    } else {
      places = this.getPlaceFromLocation(message)
    }
    if (places.length == 0) {
      await this.sendMessage(Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    } else if (places.length == 1) {
      await this.sendMessage(Messages.requestingService(places[0].name)).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
        await this.session.setPlace(places[0])
      })
    } else {
      await this.session.setStatus(Session.STATUS_CHOOSING_PLACE)
      const options: Array<PlaceOption> = []
      places.forEach((place, index) => {
        options.push({
          option: index + 1,
          placeId: place.key
        })
      })
      await this.session.setPlaceOptions(options)
      await this.sendMessage(sendPlaceOptions(options))
    }
  }
}