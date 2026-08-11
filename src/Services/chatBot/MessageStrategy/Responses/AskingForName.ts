import { ResponseContract } from '../ResponseContract'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'
import * as Sentry from '@sentry/node'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { WpContactInterface } from '../../../whatsapp/interfaces/WpContactInterface'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { MessageHandler } from '../../ai/MessageHandler'
import { GordaChatBot } from '../../ai/Services/GordaChatBot'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { Intent } from '../../../../Types/Intent'
export class AskingForName extends ResponseContract {
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.INTERACTIVE]

  public async processMessage(message: WpMessage): Promise<void> {
    if (this.isChat(message)) {
      const ia = new MessageHandler(new GordaChatBot())

      const context = this.buildAIContext(message)
      const response = await ia.handleMessage(message.msg, SessionStatuses.ASKING_FOR_NAME, context)

      // ASKING_FOR_NAME accepts both `name` and `place`; SUPPORT is checked first,
      // before any name/place handling, regardless of extracted fields.
      switch (response.intent) {
        case Intent.SUPPORT:
          await this.session.setStatus(SessionStatuses.SUPPORT)
          await this.sendAIMessage(MessagesEnum.DEFAULT_MESSAGE, response.message.body)
          break
        case Intent.PROVIDE_NAME: {
          const name = response.name || 'Usuario'
          await this.createClient(message.id, name)
          if (response.place) {
            // Name and place captured in the same turn: create the client and run the
            // place flow immediately instead of re-asking for the location.
            await this.runPlaceSearchFlow(response.place)
          } else if (!this.session.place) {
            await this.session.setStatus(SessionStatuses.ASKING_FOR_PLACE)
            await this.sendMessage(Messages.greetingNews(this.currentClient.name))
          } else if (this.session.place.name === MessageHelper.LOCATION_NO_NAME) {
            await this.sendMessage(Messages.newClientAskPlaceName(name))
            await this.session.setStatus(SessionStatuses.ASKING_FOR_PLACE)
          } else {
            await this.sendMessage(
              Messages.newClientAskForComment(name, this.session.place.name)
            ).then(async () => {
              await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
            })
          }
          break
        }
        case Intent.REFUSAL:
        case Intent.AMBIGUOUS:
        case Intent.PROVIDE_PLACE:
        default: {
          // REFUSAL/AMBIGUOUS re-ask within the same state; PROVIDE_PLACE is out of the
          // acceptance matrix without a name and falls back to the same re-ask behavior.
          const msg = Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE)
          msg.message = response.message.body
          await this.sendMessage(msg)
          break
        }
      }
    } else {
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED))
    }
  }

  private async createClient(messageId: string, name: string): Promise<void> {
    const contact = await this.getContact()
    contact.pushname = MessageHelper.normalizeName(name)
    this.currentClient = await this.store.createClient(contact)
  }

  async getContact(): Promise<WpContactInterface> {
    return new Promise((resolve, reject) => {
      this.session.chat
        .getContact()
        .then((contact) => {
          resolve(contact)
        })
        .catch((e) => {
          console.log('Error getting contact', e)
          reject(e)
          Sentry.captureException(e)
        })
    })
  }
}
