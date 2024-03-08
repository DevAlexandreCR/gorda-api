import {ResponseContract} from '../ResponseContract'
import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import MessageHelper from '../../../../Helpers/MessageHelper'
import {AskingForPlace} from './AskingForPlace'
import {WpMessage} from '../../../../Types/WpMessage'

export class Created extends ResponseContract {
  
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.LOCATION]
  
  public async processMessage(message: WpMessage): Promise<void> {
    if (this.clientExists(this.session.chat_id)) await this.validateKey(message)
    else {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(Messages.ASK_FOR_NAME)
    }
  }
  
  async validateKey(message: WpMessage): Promise<void> {
    if (this.isLocation(message)) {
      const response = new AskingForPlace(this.session)
      await response.processMessage(message)
    } else {
      await this.sendMessage(Messages.welcome(this.currentClient.name)).then(async () => {
        await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    }
  }
}