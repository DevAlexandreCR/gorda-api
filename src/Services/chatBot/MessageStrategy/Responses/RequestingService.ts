import {ResponseContract} from '../ResponseContract'
import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'
import {WpMessage} from '../../../../Types/WpMessage'

export class RequestingService extends ResponseContract {
  
  private service: Service
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  
  public async processMessage(message: WpMessage): Promise<void> {
    await this.setService()
    const body = message.msg.toLowerCase()
    if (body.includes(MessageHelper.CANCEL)) {
      await this.cancelService()
      await this.session.setStatus(Session.STATUS_COMPLETED)
    } else {
      await this.sendMessage(Messages.ASK_FOR_CANCEL_WHILE_FIND_DRIVER)
    }
  }

  cancelService(): Promise<void> {
    return this.service.cancel()
  }
  
  async setService(): Promise<void> {
      if (this.session.service_id) {
        const service = await ServiceRepository.findServiceById(this.session.service_id)
        this.service = new Service()
        Object.assign(this.service, service)
      }
  }
}