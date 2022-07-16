import Session from '../../../Models/Session'
import {Client, Message} from 'whatsapp-web.js'
import {AskingForName} from './Responses/AskingForName'
import {ResponseContract} from './ResponseContract'
import {AskingForPlace} from './Responses/AskingForPlace'
import {RequestingService} from './Responses/RequestingService'
import {ServiceInProgress} from './Responses/ServiceInProgress'
import {Created} from './Responses/Created'

export class ResponseContext {
  
  static RESPONSES = {
    [Session.STATUS_CREATED]: new Created(),
    [Session.STATUS_ASKING_FOR_NAME]: new AskingForName(),
    [Session.STATUS_ASKING_FOR_PLACE]: new AskingForPlace(),
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
    await this.response.processMessage(client, session, message)
  }
}