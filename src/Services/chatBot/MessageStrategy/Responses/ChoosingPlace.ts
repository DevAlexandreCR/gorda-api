import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import { sendPlaceOptions } from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

export class ChoosingPlace extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.LOCATION,
    MessageTypes.INTERACTIVE,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    if (this.isLocation(message) && message.location) {
      const place = await this.getPlaceFromLocation(message.location)
      if (!place) return
      return this.sendMessage(Messages.requestingService(place.name)).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
        await this.session.setPlace(place)
      })
    }
    const placeId = this.validateOption(message)
    const options = this.session.placeOptions ?? []
    if (!placeId) {
      await this.sendMessage(sendPlaceOptions(options, true))
    } else if (placeId === 'NONE_OF_THE_ABOVE') {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ASK_FOR_LOCATION))
    } else {
      const place = this.store.findPlaceById(placeId as string)
      if (place) {
        await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
          await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
          await this.session.setPlace(place)
        })
      } else {
        await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ERROR_CREATING_SERVICE))
        return this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      }
    }
  }

  private validateOption(message: WpMessage): boolean | string {
    const optionIndex = message.msg.search(/[0-9]/)
    if (optionIndex < 0) return false
    const optionFromMessage = message.msg[optionIndex]
    const options = this.session.placeOptions
    if (options === undefined) return false

    let place = options.find((opt) => opt.option.toString() == optionFromMessage)

    if (!place) {
      if (parseInt(optionFromMessage) == options.length + 1)
        place = { option: options.length + 1, placeId: 'NONE_OF_THE_ABOVE' }
      else return false
    }
    return place.placeId
  }
}
