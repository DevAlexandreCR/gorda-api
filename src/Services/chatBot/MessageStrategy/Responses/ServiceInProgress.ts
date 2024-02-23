import {ResponseContract} from '../ResponseContract'
import {Client, Message, MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import Service from '../../../../Models/Service'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import MessageHelper from '../../../../Helpers/MessageHelper'

export class ServiceInProgress extends ResponseContract{
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  private service: Service
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    await this.setService(session)
    
    if (this.service.metadata && this.service.metadata.arrived_at)
      await this.sendMessage(client, message.from, Messages.SERVICE_IN_PROGRESS)
    else {
      const body = message.body.toLowerCase()
      if (body.includes(MessageHelper.CANCEL)) {
        await this.cancelService()
        await session.setStatus(Session.STATUS_COMPLETED)
        await this.sendMessage(client, message.from, Messages.CANCELED)
      } else {
        await this.sendMessage(client, message.from, Messages.ASK_FOR_CANCEL_WHILE_WAIT_DRIVER)
      }
    }
  }
  
  cancelService(): Promise<void> {
    return this.service.cancel()
  }
  
  async setService(session: Session): Promise<void> {
    if (session.service_id) {
      const service = await ServiceRepository.findServiceById(session.service_id)
      this.service = new Service()
      Object.assign(this.service, service)
    }
  }
}