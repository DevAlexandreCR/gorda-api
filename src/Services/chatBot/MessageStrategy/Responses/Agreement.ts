import {ResponseContract} from '../ResponseContract'
import {MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import MessageHelper from '../../../../Helpers/MessageHelper'
import Place from '../../../../Models/Place'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'
import * as Sentry from '@sentry/node'
import {WpMessage} from '../../../../Types/WpMessage'

export class Agreement extends ResponseContract {
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  static readonly AGREEMENT = 'convenio'
  
  public async processMessage(message: WpMessage): Promise<void> {
    if (this.clientExists(this.session.chat_id)) {
      await this.session.setStatus(Session.STATUS_COMPLETED)
      await this.validateKey(message)
    } else {
      await this.session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(Messages.ASK_FOR_NAME)
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
        await this.createService(message, place, comment).then((serviceId: string) => {
          this.sendMessage(Messages.cancelService(serviceId))
        })
    } else {
      await this.sendMessage(Messages.BAD_AGREEMENT)
    }
  }

  getPlace(message: string): Place|null {
    let findPlace = MessageHelper.getPlaceFromAgreement(message).trim()
    let foundPlace: Place|null = null
    if (findPlace.length < 3) return foundPlace
    Array.from(this.store.places).forEach(place => {
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

    await ServiceRepository.findServiceById(serviceId).then(serviceDB => {
      const service = new Service()
      Object.assign(service, serviceDB)
      service.cancel()
    }).catch(e => {
			Sentry.captureException(e)
      this.sendMessage(Messages.SERVICE_NOT_FOUND)
    })
  }
}