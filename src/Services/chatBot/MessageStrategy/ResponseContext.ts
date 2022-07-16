import {ResponseInterface} from './ResponseInterface'
import Session from '../../../Models/Session'
import {Client, Message} from 'whatsapp-web.js'

export class ResponseContext {
  
  private response: ResponseInterface
  
  constructor(response: ResponseInterface) {
    this.response = response
  }
  
  public setResponse(response: ResponseInterface): void {
    this.response = response
  }
  
  public async processMessage(session: Session, message: Message, client: Client): Promise<void> {
    await this.response.processMessage(session, message)
    await this.response.response(client)
  }
}