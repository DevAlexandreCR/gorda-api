import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import Service from '../../../../Models/Service'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import MessageHelper from '../../../../Helpers/MessageHelper'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

export class ServiceInProgress extends ResponseContract {
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.INTERACTIVE]
  private service: Service

  public async processMessage(message: WpMessage): Promise<void> {
    await this.setService()

    if (this.service) {
      const body = message.msg.toLowerCase()
      if (body.includes(MessageHelper.CANCEL)) {
        await this.cancelService()
        await this.session.setStatus(Session.STATUS_COMPLETED)
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
