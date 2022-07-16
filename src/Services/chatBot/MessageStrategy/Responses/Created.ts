import {ResponseContract} from '../ResponseContract'
import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import MessageHelper from '../../../../Helpers/MessageHelper'
import {AskingForPlace} from './AskingForPlace'

export class Created extends ResponseContract {
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    if (this.clientExists(message)) await this.validateKey(client, session, message)
    else {
      await session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(client, message.from, Messages.ASK_FOR_NAME)
    }
  }
  
  async validateKey(client: Client, session: Session, message: Message): Promise<void> {
    if (this.isLocation(message) || MessageHelper.hasPlace(message.body)) {
      const response = new AskingForPlace()
      await response.processMessage(client, session, message)
    } else {
      await this.sendMessage(client, message.from, Messages.welcome(this.currentClient.name)).then(async () => {
        await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    }
  }
}