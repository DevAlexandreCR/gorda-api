import { randomUUID } from 'crypto'
import Session from '../../../Models/Session'
import { Store } from '../../store/Store'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import SessionRepository from '../../../Repositories/SessionRepository'
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
import ChatIdHelper from '../../../Helpers/ChatIdHelper'
import { AIRequestContext } from '../ai/Interfaces/AIRequestContext'
import { SessionStatuses } from '../../../Types/SessionStatuses'
import { PlaceSuggestionHelper } from '../PlaceSuggestionHelper'
import { PlaceOption } from '../../../Interfaces/PlaceOption'

export abstract class ResponseContract {
  protected currentClient: ClientInterface

  abstract messageSupported: Array<string>

  constructor(public session: Session) {}

  protected get store(): Store {
    return Store.getInstance()
  }

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
      await this.recordOutboundMessage(message)
    } else {
      return Promise.resolve()
    }
  }

  private async recordOutboundMessage(message: ChatBotMessage): Promise<void> {
    const wpMessage: WpMessage = {
      created_at: Date.now(),
      id: randomUUID(),
      type: MessageTypes.TEXT,
      msg: message.message,
      processed: true,
      location: null,
      interactiveReply: null,
      interactive: null,
      fromMe: true,
    }

    this.session.messages.set(wpMessage.id, wpMessage)

    try {
      await SessionRepository.addMsg(this.session.id, wpMessage, true)
    } catch (e) {
      const error = e as Error
      console.error(
        'error persisting outbound message',
        this.session.id,
        error.message,
        error.stack
      )
    }
  }

  buildAIContext(currentMessage: WpMessage): AIRequestContext {
    const history = Array.from(this.session.messages.values())
      .filter((msg) => msg.id !== currentMessage.id)
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-10)
      .map((msg) => ({
        role: msg.fromMe ? ('assistant' as const) : ('user' as const),
        text: this.renderHistoryMessage(msg),
      }))

    return {
      known: {
        name: this.currentClient?.name ?? null,
        place: this.session.place?.name ?? null,
      },
      history,
    }
  }

  private renderHistoryMessage(msg: WpMessage): string {
    if (msg.location) {
      return '[ubicación compartida]'
    }

    if (!msg.fromMe && msg.type === MessageTypes.INTERACTIVE) {
      return `[opción elegida: ${msg.msg}]`
    }

    return msg.msg
  }

  /**
   * Shared place-resolution flow used by every strategy that accepts an AI-extracted
   * `place`: strong-candidate auto-accept, confirmation for a single weaker candidate,
   * a numbered suggestion list, or a "not found" message when the search yields nothing.
   */
  protected async runPlaceSearchFlow(place: string): Promise<void> {
    const searchResult = await this.store.findPlacesWithSuggestions(place)

    if (searchResult.place && searchResult.hasStrongCandidate) {
      await this.sendMessage(Messages.requestingService(searchResult.place.name)).then(async () => {
        await this.session.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
        await this.session.setPlace(searchResult.place!)
      })
    } else if (searchResult.place) {
      const wpClient = this.store.wpClients[this.session.wp_client_id]
      const confirmationMessage = PlaceSuggestionHelper.createConfirmationMessage(
        searchResult.place.name,
        wpClient?.service,
        { id: this.session.id }
      )
      await this.sendMessage(confirmationMessage).then(async () => {
        await this.session.setStatus(SessionStatuses.CHOOSING_PLACE)

        // Store candidate place as option 0 (special case for confirmation)
        const placeOptions: PlaceOption[] = [
          { option: 0, placeId: `confirm:${searchResult.place!.id}` },
        ]

        // Add suggestions as additional options if available
        if (searchResult.suggestions && searchResult.suggestions.length > 0) {
          searchResult.suggestions.forEach((suggestion, index) => {
            placeOptions.push({ option: index + 1, placeId: suggestion.id })
          })
        }

        await this.session.setPlaceOptions(placeOptions)
      })
    } else if (searchResult.suggestions.length > 0) {
      const wpClient = this.store.wpClients[this.session.wp_client_id]
      const suggestionMessage = PlaceSuggestionHelper.createSuggestionMessage(
        searchResult.suggestions.map((suggestion, index) => ({
          option: index + 1,
          placeId: suggestion.id,
          placeName: suggestion.name,
        })),
        place,
        wpClient?.service,
        { id: this.session.id }
      )
      await this.sendMessage(suggestionMessage).then(async () => {
        await this.session.setStatus(SessionStatuses.CHOOSING_PLACE)

        // Store each suggestion as a separate PlaceOption
        const placeOptions: PlaceOption[] = searchResult.suggestions.map((suggestion, index) => ({
          option: index + 1,
          placeId: suggestion.id,
        }))

        await this.session.setPlaceOptions(placeOptions)
      })
    } else {
      const msg = Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND)
      await this.sendMessage(msg)
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
    service.client_id = ChatIdHelper.toCanonicalClientId(this.session.chat_id)
    const cityId = place.cityId || 'popayan'
    service.start_loc = {
      ...place,
      city: cityId,
      country: this.store.findCountryByCity(cityId),
    }
    service.phone = this.currentClient.phone
    service.name = this.currentClient.name
    if (comment) service.comment = comment
    const canonicalClientId = service.client_id
    try {
      service.client_completed_services_count = await Container.getServiceHistoryRepository().count(
        {
          clientId: canonicalClientId,
          status: 'terminated',
          excludeDriverOrigin: true,
        }
      )
    } catch (error) {
      service.client_completed_services_count = 0
      Sentry.captureException(error)
    }
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
