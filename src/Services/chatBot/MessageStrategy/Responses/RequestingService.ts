import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import MessageHelper from '../../../../Helpers/MessageHelper'
import * as Messages from '../../Messages'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import dayjs from 'dayjs'
import Database from '../../../firebase/Database'

export class RequestingService extends ResponseContract {
  private service: Service

  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.INTERACTIVE]

  public async processMessage(message: WpMessage): Promise<void> {
    await this.setService()

    let actionKey = ''

    // Check if message is from an interactive button
    if (message.type === MessageTypes.INTERACTIVE && message.interactiveReply) {
      if (message.interactiveReply.button_reply) {
        actionKey = message.interactiveReply.button_reply.id.toUpperCase()
      }
    }

    const body = message.msg.toLowerCase()

    if (body.includes(MessageHelper.CANCEL) || actionKey === 'CANCEL') {
      await this.cancelService()
      await this.session.setStatus(Session.STATUS_COMPLETED)
    } else if (actionKey === 'INSIST') {
      await this.restartService()
      await this.sendMessage(
        Messages.getSingleMessage(MessagesEnum.INSISTING)
      )
    } else {
      await this.sendMessage(
        Messages.getSingleMessage(MessagesEnum.ASK_FOR_CANCEL_WHILE_FIND_DRIVER)
      )
    }
  }

  cancelService(): Promise<void> {
    return this.service.cancel()
  }

  async restartService(): Promise<void> {
    if (this.service && this.service.id) {
      const newCreatedAt = dayjs().unix()
      this.service.created_at = newCreatedAt
      await Database.dbServices().child(this.service.id).update({ created_at: newCreatedAt })

      const whatsappClient = this.store.getWhatsAppClient(this.session.wp_client_id)
      if (whatsappClient) {
        whatsappClient.cancelTimeout(this.service.id, this.session.chat_id)
      }
    }
  }

  async setService(): Promise<void> {
    if (this.session.service_id) {
      const service = await ServiceRepository.findServiceById(this.session.service_id)
      this.service = new Service()
      Object.assign(this.service, service)
    }
  }
}
