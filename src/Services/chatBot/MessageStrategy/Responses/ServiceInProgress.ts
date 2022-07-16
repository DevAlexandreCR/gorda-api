import {ResponseContract} from '../ResponseContract'
import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'

export class ServiceInProgress extends ResponseContract{
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    await this.sendMessage(client, message.from, Messages.SERVICE_IN_PROGRESS)
  }
}