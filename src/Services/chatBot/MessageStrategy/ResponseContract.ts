import Session from '../../../Models/Session'
import { Store } from '../../store/Store'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import * as Messages from '../Messages'
import MessageHelper from '../../../Helpers/MessageHelper'
import * as Sentry from '@sentry/node'
import { WpMessage } from '../../../Types/WpMessage'
import { WpLocation } from '../../../Types/WpLocation'
import { exit } from 'process'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'
import { MessagesEnum } from '../MessagesEnum'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { City } from '../../../Interfaces/City'
import { LatLng } from '../../../Interfaces/LatLng'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../../Interfaces/ClientInterface'
import Container from '../../../Container/Container'

export abstract class ResponseContract {
  protected store: Store = Store.getInstance()
  protected currentClient: ClientInterface

  abstract messageSupported: Array<string>

  constructor(public session: Session) { }

  abstract processMessage(message: WpMessage): Promise<void>

  isChat(message: WpMessage): boolean {
    return message.type === MessageTypes.TEXT
  }

  isLocation(message: WpMessage): boolean {
    return message.type === MessageTypes.LOCATION
  }

  async sendMessage(message: ChatBotMessage): Promise<void> {
    if (message.enabled) {
      await this.retryPromise<void>(this.session.sendMessage(message), 3).catch((e) => {
        Sentry.captureException(e)
        exit(1)
      })
    } else {
      return Promise.resolve()
    }
  }

  private getWpClientId(): string {
    return this.session.wp_client_id
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

  async createService(place: PlaceInterface, comment: string | null = null): Promise<string> {
    const service = new Service()
    service.wp_client_id = this.getWpClientId()
    service.client_id = this.session.chat_id
    service.start_loc = place
    service.phone = this.currentClient.phone
    service.name = this.currentClient.name
    if (comment) service.comment = comment
    const dbService = await ServiceRepository.create(service)
    this.session.service_id = dbService.id
    if (this.session.service_id)
      await this.session
        .setService(this.session.service_id)
        .then(async () => {
          await this.session.setStatus(Session.STATUS_REQUESTING_SERVICE)
        })
        .catch(async (e: Error) => {
          console.error('error creating service', this.session.chat_id, e.message, e.stack)
          await this.sendMessage(Messages.getSingleMessage(MessagesEnum.ERROR_CREATING_SERVICE))
          await this.session.setStatus(Session.STATUS_ASKING_FOR_COMMENT)
        })

    return Promise.resolve(service.id)
  }

  async getPlaceFromLocation(location: WpLocation): Promise<PlaceInterface | false> {
    const place: PlaceInterface = { id: '', name: '', location: null, lat: 0, lng: 0, cityId: '' }
    const latlng: LatLng = { lat: location.lat, lng: location.lng }
    const city = await this.findContainingPolygon(latlng)
    if (city) {
      place.lat = location.lat
      place.lng = location.lng
      place.name = location.name || MessageHelper.LOCATION_NO_NAME
      place.cityId = city.id

      return place
    } else {
      await this.sendMessage(Messages.getSingleMessage(MessagesEnum.NON_COVERED_AREA))
      await this.session.setStatus(Session.STATUS_COMPLETED)
      return false
    }
  }

  async getPlaceFromMessage(message: string): Promise<Array<PlaceInterface>> {
    const findPlace = MessageHelper.getPlace(message)
    const foundPlaces: Array<PlaceInterface> = []
    if (findPlace.length < 3) return foundPlaces

    const placeRepository = Container.getPlaceRepository()
    return await placeRepository.findByName(findPlace, 'popayan')
  }

  supportMessage(message: WpMessage): boolean {
    return this.messageSupported.includes(message.type)
  }

  protected retryPromise<T>(promiseFactory: Promise<T>, maxRetries: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = (attemptNumber: number) => {
        promiseFactory.then(resolve).catch((error) => {
          if (attemptNumber < maxRetries) {
            console.log(`Retry attempt ${attemptNumber + 1}/${maxRetries}`, {
              error: error.message,
            })
            setTimeout(() => attempt(attemptNumber + 1), 2000)
          } else {
            reject(error)
          }
        })
      }
      attempt(0)
    })
  }

  protected async findContainingPolygon(latlng: LatLng): Promise<City | null> {
    let city: City | null = null
    city = this.store.findCityById('popayan') ?? null
    // this.store.polygons.forEach((polygon) => {
    //   const geoPoint = point([latlng.lat, latlng.lng])
    //   if (booleanPointInPolygon(geoPoint, polygon)) {
    //     if (polygon.properties) {
    //       city = this.store.findCityById(polygon.properties.name)?? null
    //     }
    //   }
    // })
    return city
  }

  protected async sendAIMessage(MessagesEnum: MessagesEnum, customMessage?: string) {
    const msg = Messages.getSingleMessage(MessagesEnum)
    if (customMessage) {
      msg.message = customMessage
      if (msg.interactive?.body) {
        msg.interactive.body.text = customMessage
      }
    }
    await this.sendMessage(msg)
  }
}
