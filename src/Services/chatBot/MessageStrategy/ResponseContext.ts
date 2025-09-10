import Session from '../../../Models/Session'
import { AskingForName } from './Responses/AskingForName'
import { ResponseContract } from './ResponseContract'
import { AskingForPlace } from './Responses/AskingForPlace'
import { RequestingService } from './Responses/RequestingService'
import { ServiceInProgress } from './Responses/ServiceInProgress'
import { Created } from './Responses/Created'
import * as Messages from '../Messages'
import { ChoosingPlace } from './Responses/ChoosingPlace'
import { AskingForComment } from './Responses/AskingForComment'
import { Agreement } from './Responses/Agreement'
import { WpMessage } from '../../../Types/WpMessage'
import { getSingleMessage } from '../Messages'
import { MessagesEnum } from '../MessagesEnum'

export class ResponseContext {
  private response: ResponseContract

  constructor(response: ResponseContract) {
    this.response = response
  }

  public setResponse(response: ResponseContract): void {
    this.response = response
  }

  public static getResponse(status: string, session: Session): ResponseContract {
    const responses: { [key: string]: ResponseContract } = {
      [Session.STATUS_AGREEMENT]: new Agreement(session),
      [Session.STATUS_CREATED]: new Created(session),
      [Session.STATUS_ASKING_FOR_NAME]: new AskingForName(session),
      [Session.STATUS_ASKING_FOR_PLACE]: new AskingForPlace(session),
      [Session.STATUS_CHOOSING_PLACE]: new ChoosingPlace(session),
      [Session.STATUS_ASKING_FOR_COMMENT]: new AskingForComment(session),
      [Session.STATUS_REQUESTING_SERVICE]: new RequestingService(session),
      [Session.STATUS_SERVICE_IN_PROGRESS]: new ServiceInProgress(session),
    }

    return responses[status]
  }

  public async processMessage(message: WpMessage): Promise<void> {
    if (!this.response.supportMessage(message)) {
      const msg = getSingleMessage(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED)
      if (msg.enabled) {
        return this.response.session.sendMessage(msg).then(() => {
          console.log('Message not supported')
        })
      }
    }

    await this.response.processMessage(message)
  }
}
