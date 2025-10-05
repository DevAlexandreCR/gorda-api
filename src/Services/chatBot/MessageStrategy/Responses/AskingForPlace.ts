import { ResponseContract } from '../ResponseContract'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { MessageHandler } from '../../ai/MessageHandler'
import { GordaChatBot } from '../../ai/Services/GordaChatBot'
import { PlaceSuggestionHelper } from '../../PlaceSuggestionHelper'
import { PlaceOption } from '../../../../Interfaces/PlaceOption'

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
          const searchResult = await this.store.findPlacesWithSuggestions(response.place)

          if (searchResult.place && searchResult.hasExactMatch) {
            await this.sendMessage(Messages.requestingService(searchResult.place.name)).then(async () => {
              await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
              await this.session.setPlace(searchResult.place!)
            })
          } else if (searchResult.place && !searchResult.hasExactMatch) {
            const wpClient = this.store.wpClients[this.session.wp_client_id]
            const confirmationMessage = PlaceSuggestionHelper.createConfirmationMessage(
              searchResult.place.name,
              wpClient?.service,
              { id: this.session.id }
            )
            await this.sendMessage(confirmationMessage).then(async () => {
              await this.session.setStatus(SessionStatuses.CHOOSING_PLACE)

              // Store candidate place as option 0 (special case for confirmation)
              const placeOptions: PlaceOption[] = [
                { option: 0, placeId: `confirm:${searchResult.place!.id}` }
              ]

              // Add suggestions as additional options if available
              if (searchResult.suggestions && searchResult.suggestions.length > 0) {
                searchResult.suggestions.forEach((suggestion, index) => {
                  placeOptions.push({ option: index + 1, placeId: suggestion.id })
                })
              }

              await this.session.setPlaceOptions(placeOptions)
            })
          } else if (searchResult.suggestions.length > 0) {
            const wpClient = this.store.wpClients[this.session.wp_client_id]
            const suggestionMessage = PlaceSuggestionHelper.createSuggestionMessage(
              searchResult.suggestions.map((suggestion, index) => ({
                option: index + 1,
                placeId: suggestion.id,
                placeName: suggestion.name
              })),
              response.place,
              wpClient?.service,
              { id: this.session.id }
            )
            await this.sendMessage(suggestionMessage).then(async () => {
              await this.session.setStatus(SessionStatuses.CHOOSING_PLACE)

              // Store each suggestion as a separate PlaceOption
              const placeOptions: PlaceOption[] = searchResult.suggestions.map((suggestion, index) => ({
                option: index + 1,
                placeId: suggestion.id
              }))

              await this.session.setPlaceOptions(placeOptions)
            })
          } else {
            const msg = Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND)
            await this.sendMessage(msg)
          }
        } else if (response.sessionStatus === SessionStatuses.SUPPORT) {
          await this.sendAIMessage(MessagesEnum.DEFAULT_MESSAGE, response.message.body)
          await this.session.setStatus(SessionStatuses.SUPPORT)
        } else {
          await this.sendAIMessage(MessagesEnum.ASK_FOR_LOCATION, response.message.body)
        }
      }
    } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME && this.isChat(message)) {
      const name = MessageHelper.normalize(message.msg)
      if (name.length > 3 && MessageHelper.isPlaceName(name)) {
        const place = this.session.place
        place.name = name
        await this.sendMessage(Messages.requestingService(place.name)).then(async () => {
          await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
          await this.session.setPlace(place)
        })
      } else {
        await this.sendMessage(Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND))
      }
    } else {
      await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
      this.session.processMessage(message, [])
    }
  }
}
