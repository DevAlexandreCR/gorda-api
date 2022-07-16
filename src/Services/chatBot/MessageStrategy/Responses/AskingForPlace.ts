import {Client, Message} from 'whatsapp-web.js'
import Session from '../../../../Models/Session'
import {ResponseContract} from '../ResponseContract'
import * as Messages from '../../Messages'
import Place from '../../../../Models/Place'
import MessageHelper from '../../../../Helpers/MessageHelper'
import Service from '../../../../Models/Service'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import SessionRepository from '../../../../Repositories/SessionRepository'

export class AskingForPlace extends ResponseContract{
  
  
  public async processMessage(client: Client, session: Session, message: Message): Promise<void> {
    let place: Array<Place> = []
    this.setCurrentClient(message)
    if (this.isChat(message)) {
      place = this.getPlaceFromMessage(message)
    } else if (this.isLocation(message)){
      place = this.getPlaceFromLocation(message)
    } else {
      return this.sendMessage(client, message.from, Messages.MESSAGE_TYPE_NOT_SUPPORTED).then(async () => {
        await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    }
    if (place.length) {
      await this.sendMessage(client, message.from, Messages.requestingService(place[0].name)).then(async () => {
        await this.createService(place[0], session)
          .then(async () => {
            await this.sendMessage(client, message.from, Messages.ASK_FOR_DRIVER).then(async () => {
              await session.setStatus(Session.STATUS_REQUESTING_SERVICE)
            })
          })
          .catch(async (e) => {
            console.log(e.message)
            await this.sendMessage(client, message.from, Messages.ERROR_CREATING_SERVICE)
          })
      })
    } else {
      await this.sendMessage(client, message.from, Messages.NON_NEIGHBORHOOD_FOUND).then(async () => {
        await session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })
    }
    
  }
  
  getPlaceFromLocation(message: Message): Array<Place> {
    const locationMessage = message.location
    const place = new Place()
    if (locationMessage.description && locationMessage.description.length > 2) {
      place.name = locationMessage.description
    } else {
      place.name = MessageHelper.USER_LOCATION
    }
    place.lat = parseFloat(locationMessage.latitude)
    place.lng = parseFloat(locationMessage.longitude)
    
    return [place]
  }
  
  getPlaceFromMessage(message: Message): Array<Place> {
    const findPlace = MessageHelper.hasPlace(message.body)
    const foundPlaces: Array<Place> = []
    if (findPlace)
      Array.from(this.store.places).some(place => {
        const placeName = MessageHelper.normalice(place.name)
        if (placeName.includes(findPlace)) {
          foundPlaces.push(place)
          return true
        }
      })
    
    return foundPlaces
  }
  
  async createService(place: Place, session: Session): Promise<void> {
    const service = new Service()
    service.client_id = session.chat_id
    service.start_loc = place
    service.phone = this.currentClient.phone
    service.name = this.currentClient.name
    const dbService = await ServiceRepository.create(service)
    session.service_id = dbService.id
    await SessionRepository.update(session)
  }
}