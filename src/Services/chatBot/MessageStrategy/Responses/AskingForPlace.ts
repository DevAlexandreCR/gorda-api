import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import Place from '../../../../Models/Place'
import {PlaceOption} from '../../../../Interfaces/PlaceOption'
import {sendPlaceOptions} from '../../Messages'

export class AskingForPlace extends ResponseContract{
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    let places: Array<Place> = []
    if (this.isChat(message)) {
      places = this.getPlaceFromMessage(message)
    } else {
      places = this.getPlaceFromLocation(message)
    }
    if (places.length == 0) {
      await this.sendMessage(client, message.from, Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
        await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    } else if (places.length == 1) {
      await this.sendMessage(client, message.from, Messages.requestingService(places[0].name)).then(async () => {
        await session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
        await session.setPlace(places[0].key)
      })
    } else {
      await session.setStatus(Session.STATUS_CHOOSING_PLACE)
      const options: Array<PlaceOption> = []
      places.forEach((place, index) => {
        options.push({
          option: index + 1,
          placeId: place.key
        })
      })
      await session.setPlaceOptions(options)
      await this.sendMessage(client, message.from, sendPlaceOptions(options))
    }
  }
}