import {ResponseContract} from '../ResponseContract'
import {Client, Message, MessageTypes} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import * as Messages from '../../Messages'
import MessageHelper from '../../../../Helpers/MessageHelper'
import Place from '../../../../Models/Place'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Service from '../../../../Models/Service'

export class Agreement extends ResponseContract {
  
  public messageSupported: Array<string> = [MessageTypes.TEXT]
  static readonly AGREEMENT = 'convenio'
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    if (this.clientExists(message)) {
      await session.setStatus(Session.STATUS_COMPLETED)
      await this.validateKey(client, session, message)
    } else {
      await session.setStatus(Session.STATUS_ASKING_FOR_NAME)
      await this.sendMessage(client, message.from, Messages.ASK_FOR_NAME)
    }
  }
  
  async validateKey(client: Client, session: Session, message: Message): Promise<void> {
    if (MessageHelper.isCancel(message.body)) {
      return this.cancelService(message, client)
    }
    const place = this.getPlace(message)
    const comment = MessageHelper.getCommentFromAgreement(message.body)
    if (place) {
        await session.setPlace(place)
        await this.createService(client, message, place, session, comment).then((serviceId: string) => {
          this.sendMessage(client, message.from, Messages.cancelService(serviceId))
        })
    } else {
      await this.sendMessage(client, message.from, Messages.BAD_AGREEMENT)
    }
  }

  getPlace(message: Message): Place|null {
    let findPlace = MessageHelper.getPlaceFromAgreement(message.body).trim()
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

  async cancelService(message: Message, client: Client): Promise<void> {
    const serviceId = MessageHelper.getServiceIdFromCancel(message.body)
    console.log(serviceId);
    
    await ServiceRepository.findServiceById(serviceId).then(serviceDB => {
      const service = new Service()
      Object.assign(service, serviceDB)
      service.cancel()
    }).catch(e => {
      console.log(e.message);
      this.sendMessage(client, message.from, Messages.SERVICE_NOT_FOUND)
    })
  }
}