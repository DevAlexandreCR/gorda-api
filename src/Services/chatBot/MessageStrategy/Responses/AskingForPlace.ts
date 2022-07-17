import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import Place from '../../../../Models/Place'
import {PlaceOption} from '../../../../Interfaces/PlaceOption'
import {sendPlaceOptions} from '../../Messages'
import SessionRepository from '../../../../Repositories/SessionRepository'

export class AskingForPlace extends ResponseContract{
  
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    let places: Array<Place> = []
    this.setCurrentClient(message)
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
        await this.createService(client, message, places[0], session)
      })
    } else {
      await session.setStatus(Session.STATUS_CHOOSING_PLACE)
      const options: Array<PlaceOption> = []
      places.forEach((place, index) => {
        options.push({
          option: index + 1,
          placeName: place.name
        })
      })
      session.placeOptions = options
      await SessionRepository.update(session)
      await this.sendMessage(client, message.from, sendPlaceOptions(options))
    }
  }
}