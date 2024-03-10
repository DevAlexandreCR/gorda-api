import {ResponseContract} from '../ResponseContract'
import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import Service from '../../../../Models/Service'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import MessageHelper from '../../../../Helpers/MessageHelper'
import {WpMessage} from '../../../../Types/WpMessage'

export class ServiceInProgress extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  private service: Service
  
  public async processMessage(message: WpMessage): Promise<void> {
    await this.setService()
    
    if (this.service.metadata && this.service.metadata.arrived_at)
      await this.sendMessage(Messages.SERVICE_IN_PROGRESS)
    else {
      const body = message.msg.toLowerCase()
      if (body.includes(MessageHelper.CANCEL)) {
        await this.cancelService()
        await this.session.setStatus(Session.STATUS_COMPLETED)
      } else {
        await this.sendMessage(Messages.ASK_FOR_CANCEL_WHILE_WAIT_DRIVER)
      }
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