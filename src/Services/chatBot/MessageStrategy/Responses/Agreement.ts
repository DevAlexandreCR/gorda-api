import { ResponseContract } from '../ResponseContract'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import MessageHelper from '../../../../Helpers/MessageHelper'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'
import * as Sentry from '@sentry/node'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessagesEnum } from '../../MessagesEnum'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'

export class Agreement extends ResponseContract {
  public messageSupported: Array<string> = [MessageTypes.TEXT, MessageTypes.INTERACTIVE]
  static readonly AGREEMENT = 'convenio'

  public async processMessage(message: WpMessage): Promise<void> {
    if (this.clientExists(this.session.chat_id)) {
      await this.session.setStatus(Session.STATUS_COMPLETED)
      await this.validateKey(message)
    } else {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ASK_FOR_NAME))
    }
  }

  async validateKey(message: WpMessage): Promise<void> {
    if (MessageHelper.isCancel(message.msg)) {
      return this.cancelService(message)
    }
    const place = this.getPlace(message.msg)
    const comment = MessageHelper.getCommentFromAgreement(message.msg)
    if (place) {
      await this.session.setPlace(place)
      await this.createService(place, comment)
    } else {
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE))
    }
  }

  getPlace(message: string): PlaceInterface | null {
    let findPlace = MessageHelper.getPlaceFromAgreement(message).trim()
    let foundPlace: PlaceInterface | null = null
    if (findPlace.length < 3) return foundPlace
    Array.from(this.store.places).forEach((place) => {
      const placeName = MessageHelper.normalize(place.name)
      findPlace = MessageHelper.normalize(findPlace)
      if (placeName === findPlace) {
        foundPlace = place
      }
    })

    return foundPlace
  }

  async cancelService(message: WpMessage): Promise<void> {
    const serviceId = MessageHelper.getServiceIdFromCancel(message.msg)

    await ServiceRepository.findServiceById(serviceId)
      .then((serviceDB) => {
        const service = new Service()
        Object.assign(service, serviceDB)
        service.cancel()
      })
      .catch((e) => {
        Sentry.captureException(e)
        this.sendMessage(Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE))
      })
  }
}
