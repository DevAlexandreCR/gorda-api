import { ResponseContract } from '../ResponseContract'
import * as Messages from '../../Messages'
import { WpMessage } from '../../../../Types/WpMessage'
import MessageHelper from '../../../../Helpers/MessageHelper'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { MessageHandler } from '../../ai/MessageHandler'
import { GordaChatBot } from '../../ai/Services/GordaChatBot'
import { Intent } from '../../../../Types/Intent'

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
        const context = this.buildAIContext(message)
        const response = await ia.handleMessage(
          message.msg,
          SessionStatuses.ASKING_FOR_PLACE,
          context
        )
        // ASKING_FOR_PLACE only accepts `place`; any `name` the AI extracts is discarded.
        // SUPPORT is checked first, before any place handling, regardless of extracted fields.
        switch (response.intent) {
          case Intent.SUPPORT:
            await this.sendAIMessage(MessagesEnum.DEFAULT_MESSAGE, response.message.body)
            await this.session.setStatus(SessionStatuses.SUPPORT)
            break
          case Intent.PROVIDE_PLACE:
            if (response.place) {
              await this.runPlaceSearchFlow(response.place)
            } else {
              await this.sendAIMessage(MessagesEnum.ASK_FOR_LOCATION, response.message.body)
            }
            break
          case Intent.REFUSAL:
          case Intent.AMBIGUOUS:
          case Intent.PROVIDE_NAME:
          default:
            // REFUSAL/AMBIGUOUS re-ask within the same state; PROVIDE_NAME is out of the
            // acceptance matrix here and falls back to the same re-ask behavior.
            await this.sendAIMessage(MessagesEnum.ASK_FOR_LOCATION, response.message.body)
            break
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
