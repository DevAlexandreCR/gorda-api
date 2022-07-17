import Session from '../../../Models/Session'
import {Client, Message, MessageTypes} from 'whatsapp-web.js'
import {AskingForName} from './Responses/AskingForName'
import {ResponseContract} from './ResponseContract'
import {AskingForPlace} from './Responses/AskingForPlace'
import {RequestingService} from './Responses/RequestingService'
import {ServiceInProgress} from './Responses/ServiceInProgress'
import {Created} from './Responses/Created'
import * as Messages from '../Messages'
import {ChoosingPlace} from './Responses/ChoosingPlace'
import {AskingForComment} from './Responses/AskingForComment'

export class ResponseContext {
  
  static RESPONSES = {
    [Session.STATUS_CREATED]: new Created(),
    [Session.STATUS_ASKING_FOR_NAME]: new AskingForName(),
    [Session.STATUS_ASKING_FOR_PLACE]: new AskingForPlace(),
    [Session.STATUS_CHOOSING_PLACE]: new ChoosingPlace(),
    [Session.STATUS_ASKING_FOR_COMMENT]: new AskingForComment(),
    [Session.STATUS_REQUESTING_SERVICE]: new RequestingService(),
    [Session.STATUS_SERVICE_IN_PROGRESS]: new ServiceInProgress(),
  }
  
  private response: ResponseContract
  
  constructor(response: ResponseContract) {
    this.response = response
  }
  
  public setResponse(response: ResponseContract): void {
    this.response = response
  }
  
  public async processMessage(session: Session, message: Message, client: Client): Promise<void> {
    if (!this.isMessageSupported(message))
    return client.sendMessage(message.from, Messages.MESSAGE_TYPE_NOT_SUPPORTED).then(async () => {
      await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
    })
    await this.response.processMessage(client, session, message)
  }
  
  public isMessageSupported(message: Message): boolean {
    return message.type === MessageTypes.TEXT || message.type === MessageTypes.LOCATION
  }
}