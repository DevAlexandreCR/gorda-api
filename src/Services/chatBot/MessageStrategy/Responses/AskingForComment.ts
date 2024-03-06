import {ResponseContract} from '../ResponseContract'
import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'
import {WpMessage} from '../../../../Types/WpMessage'

export class AskingForComment extends ResponseContract {
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(message: WpMessage): Promise<void> {
    this.setCurrentClient(this.session.chat_id)
    let comment = null
    if (this.hasComment(message)) {
      comment = message.msg
    }
    
    const place = this.session.place
    
    if (place) await this.createService(place, comment)
    else {
      await this.sendMessage(Messages.ERROR_CREATING_SERVICE)
      await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
    }
  }
  
  hasComment(message: WpMessage): boolean {
    const msg = MessageHelper.normalize(message.msg)
    return msg.length > 3
  }
}