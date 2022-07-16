import {ResponseContract} from '../ResponseContract'
import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'

export class RequestingService extends ResponseContract {
  
  private service: Service
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    await this.setService(session)
    const body = message.body.toLowerCase()
    if (body.includes(MessageHelper.CANCEL)) {
      this.cancelService(session)
    } else {
      await this.sendMessage(client, message.from, Messages.ASK_FOR_CANCEL_WHILE_FIND_DRIVER)
    }
  }
  
  cancelService(session:Session): void {
    this.service.cancel().then(async () => await session.setStatus(Session.STATUS_COMPLETED))
  }
  
  async setService(session: Session): Promise<void> {
      if (session.service_id) {
        const service = await ServiceRepository.findServiceById(session.service_id)
        this.service = new Service()
        Object.assign(this.service, service)
      }
  }
}