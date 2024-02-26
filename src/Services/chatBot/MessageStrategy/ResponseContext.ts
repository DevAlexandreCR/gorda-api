import Session from '../../../Models/Session'
import {AskingForName} from './Responses/AskingForName'
import {ResponseContract} from './ResponseContract'
import {AskingForPlace} from './Responses/AskingForPlace'
import {RequestingService} from './Responses/RequestingService'
import {ServiceInProgress} from './Responses/ServiceInProgress'
import {Created} from './Responses/Created'
import * as Messages from '../Messages'
import {ChoosingPlace} from './Responses/ChoosingPlace'
import {AskingForComment} from './Responses/AskingForComment'
import { Agreement } from './Responses/Agreement'
import {WpMessage} from '../../../Types/WpMessage'

export class ResponseContext {

  static RESPONSES = {
    [Session.STATUS_AGREEMENT]: Agreement,
    [Session.STATUS_CREATED]: Created,
    [Session.STATUS_ASKING_FOR_NAME]: AskingForName,
    [Session.STATUS_ASKING_FOR_PLACE]: AskingForPlace,
    [Session.STATUS_CHOOSING_PLACE]: ChoosingPlace,
    [Session.STATUS_ASKING_FOR_COMMENT]: AskingForComment,
    [Session.STATUS_REQUESTING_SERVICE]: RequestingService,
    [Session.STATUS_SERVICE_IN_PROGRESS]: ServiceInProgress,
  }
  
  private response: ResponseContract
  
  constructor(response: ResponseContract) {
    this.response = response
  }
  
  public setResponse(response: ResponseContract): void {
    this.response = response
  }
  
  public async processMessage(message: WpMessage): Promise<void> {
    if (!this.response.supportMessage(message))
    return this.response.session.wpClient.sendMessage(this.response.session.chat_id, Messages.MESSAGE_TYPE_NOT_SUPPORTED).then(() => {
      console.log('Message not supported')
    })
    await this.response.processMessage(message)
  }
}