import {ResponseContract} from '../ResponseContract'
import {Client, Message, MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'

export class AskingForComment extends ResponseContract {
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    this.setCurrentClient(message)
    let comment = null
    if (this.hasComment(message)) {
      comment = message.body
    }
    
    const place = session.place
    
    if (place) await this.createService(client, message, place, session,comment)
    else {
      await this.sendMessage(client, message.from, Messages.ERROR_CREATING_SERVICE)
      await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
    }
  }
  
  hasComment(message: Message): boolean {
    const msg = MessageHelper.normalize(message.body)
    return msg.length > 3
  }
}