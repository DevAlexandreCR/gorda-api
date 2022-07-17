import {ResponseContract} from '../ResponseContract'
import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ASK_FOR_NEIGHBORHOOD, NONE_OF_THE_ABOVE, sendPlaceOptions} from '../../Messages'
import * as Messages from '../../Messages'

export class ChoosingPlace extends ResponseContract {
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    this.setCurrentClient(message)
    if (this.isLocation(message)) {
      const places = this.getPlaceFromLocation(message)
      return  this.sendMessage(client, message.from, Messages.requestingService(places[0].name)).then(async () => {
        await this.createService(client, message, places[0], session)
      })
    }
    const placeName = this.validateOption(session, message)
    const options = session.placeOptions?? []
    if (!placeName) {
      await  this.sendMessage(client, message.from, sendPlaceOptions(options, true))
    } else if (placeName === NONE_OF_THE_ABOVE) {
      await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      await this.sendMessage(client, message.from, ASK_FOR_NEIGHBORHOOD)
    } else {
      const place = this.store.findPlaceByName(placeName as string)
      if (place) {
        await this.sendMessage(client, message.from, Messages.requestingService(place.name)).then(async () => {
          await this.createService(client, message, place, session)
        })
      } else {
        await this.sendMessage(client, message.from, Messages.ERROR_CREATING_SERVICE)
        return session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      }
    }
  }
  
  private validateOption(session: Session, message: Message): boolean | string {
    const optionIndex = message.body.search(/[0-9]/)
    if (optionIndex < 0) return false
    const optionFromMessage = message.body[optionIndex]
    const options = session.placeOptions
    if (options === undefined) return false
  
    let place = options.find(opt => opt.option.toString() == optionFromMessage)
  
    if (!place) {
      if (parseInt(optionFromMessage) == options.length + 1) place = {option: options.length + 1, placeName: NONE_OF_THE_ABOVE}
      else return false
    }
    return place.placeName
  }
}