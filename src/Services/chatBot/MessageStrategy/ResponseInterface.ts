import Session from '../../../Models/Session'
import {Client, Message} from 'whatsapp-web.js'

export interface ResponseInterface {
  processMessage(session: Session, message: Message): Promise<void>
  
  response(client: Client): Promise<void>
}