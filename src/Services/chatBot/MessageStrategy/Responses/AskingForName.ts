import {ResponseInterface} from '../ResponseInterface'
import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'

export class AskingForName implements ResponseInterface{
  public processMessage(session: Session, message: Message): Promise<void> {
    return Promise.resolve();
  }
  
  public response(client: Client): Promise<void> {
    return Promise.resolve();
  }
}