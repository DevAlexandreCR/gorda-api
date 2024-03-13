import Session from '../../../Models/Session'
import {MessageTypes} from 'whatsapp-web.js'
import {Store} from '../../store/Store'
import CurrentClient from '../../../Models/Client'
import Place from '../../../Models/Place'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import * as Messages from '../Messages'
import MessageHelper from '../../../Helpers/MessageHelper'
import * as Sentry from '@sentry/node'
import {WpMessage} from '../../../Types/WpMessage'
import {WpLocation} from '../../../Types/WpLocation'
import {exit} from 'process'

export abstract class ResponseContract {
  
  protected store: Store = Store.getInstance()
  protected currentClient: CurrentClient
  
  abstract messageSupported: Array<string>

  constructor(public session: Session) {
  }

  abstract processMessage(message: WpMessage): Promise<void>

  isChat(message: WpMessage): boolean {
    return message.type === MessageTypes.TEXT
  }
  
  isLocation(message: WpMessage): boolean {
    return message.type === MessageTypes.LOCATION
  }
  
  async sendMessage(content: string): Promise<void> {
    await this.retryPromise<void>(this.session.sendMessage(content), 3)
      .catch(e => {
        Sentry.captureException(e)
        exit(1)
      })
  }

  private getWpClientId(): string {
    return this.session.wpClient.info.wid.user.slice(-10)
  }
  
  setCurrentClient(chatId: string): void {
    const client = this.store.findClientById(chatId)
    if (client) this.currentClient = client
  }
  
  clientExists(chatId: string): boolean {
    const client = this.store.findClientById(chatId)
    if (client) this.currentClient = client
    return client != undefined
  }
  
  async createService(place: Place, comment: string|null = null): Promise<string> {
    const service = new Service()
    service.wp_client_id = this.getWpClientId()
    service.client_id = this.session.chat_id
    service.start_loc = place
    service.phone = this.currentClient.phone
    service.name = this.currentClient.name
    if (comment) service.comment = comment
    const dbService = await ServiceRepository.create(service)
    this.session.service_id = dbService.id
    if(this.session.service_id) await this.session.setService(this.session.service_id)
      .then(async () => {
        await this.sendMessage(Messages.NEW_SERVICE).then(async () => {
          await this.session.setStatus(Session.STATUS_REQUESTING_SERVICE)
        })
      })
      .catch(async (e) => {
        console.error(e.message)
        await this.sendMessage(Messages.ERROR_CREATING_SERVICE)
        await this.session.setStatus(Session.STATUS_ASKING_FOR_PLACE)
      })

    return Promise.resolve(service.id)
  }
  
  getPlaceFromLocation(location: WpLocation): Place {
    const place = new Place()
    place.lat = location.lat
    place.lng = location.lng
    place.name = location.name || MessageHelper.LOCATION_NO_NAME

    return place
  }
  
  getPlaceFromMessage(message: string): Array<Place> {
    const findPlace = MessageHelper.getPlace(message)
    const foundPlaces: Array<Place> = []
    if (findPlace.length < 3) return foundPlaces
    Array.from(this.store.places).forEach(place => {
      const placeName = MessageHelper.normalize(place.name)
      if (placeName.includes(findPlace)) {
        foundPlaces.push(place)
      }
    })
    
    return foundPlaces
  }
  
  supportMessage(message: WpMessage): boolean {
    return this.messageSupported.includes(message.type)
  }

  protected retryPromise<T>(promiseFactory: Promise<T>, maxRetries: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = (attemptNumber: number) => {
        promiseFactory
        .then(resolve)
        .catch(error => {
          if (attemptNumber < maxRetries) {
            console.log(`Retry attempt ${attemptNumber + 1}/${maxRetries}`, {
              error: error.message
            })
            setTimeout(() => attempt(attemptNumber + 1), 1000)
          } else {
            reject(error)
          }
        });
      };
      attempt(0);
    });
  }
}