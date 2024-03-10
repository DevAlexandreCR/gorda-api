import {SessionInterface} from '../Interfaces/SessionInterface'
import SessionRepository from '../Repositories/SessionRepository'
import {PlaceOption} from '../Interfaces/PlaceOption'
import Place from './Place'
import {WpMessage} from '../Types/WpMessage'
import {ResponseContext} from '../Services/chatBot/MessageStrategy/ResponseContext'
import {Client, Message, MessageTypes} from 'whatsapp-web.js'
import MessageHelper from '../Helpers/MessageHelper'
import {WpLocation} from '../Types/WpLocation'

export default class Session implements SessionInterface {
  public id: string
  public status: string
  public chat_id: string
  public placeOptions?: Array<PlaceOption>
  public assigned_at: number = 0
  public service_id: string | null
  public created_at: number
  public updated_at: number | null
  public place: Place | null = null
  public messages: Map<string, WpMessage> = new Map()
  public wpClient: Client
  private processorTimeout?: NodeJS.Timer
  public onCanceled: () => void

  static readonly STATUS_AGREEMENT = 'AGREEMENT'
  static readonly STATUS_CREATED = 'CREATED'
  static readonly STATUS_ASKING_FOR_PLACE = 'ASKING_FOR_PLACE'
  static readonly STATUS_CHOOSING_PLACE = 'CHOOSING_PLACE'
  static readonly STATUS_ASKING_FOR_COMMENT = 'ASKING_FOR_COMMENT'
  static readonly STATUS_REQUESTING_SERVICE = 'REQUESTING_SERVICE'
  static readonly STATUS_SERVICE_IN_PROGRESS = 'SERVICE_IN_PROGRESS'
  static readonly STATUS_COMPLETED = 'COMPLETED'
  static readonly STATUS_ASKING_FOR_NAME = 'ASKING_FOR_NAME'
  
  constructor(chat_id: string) {
    this.chat_id = chat_id
    this.created_at = new Date().getTime()
    this.status = Session.STATUS_CREATED
    this.service_id = null
  }

  setOnCanceled(callback: () => void): void {
    this.onCanceled = callback
  }
  
  isCompleted(): boolean {
    return this.status === Session.STATUS_COMPLETED
  }

  async setAssigned(assigned: boolean = true): Promise<void> {
    this.assigned_at = assigned ? new Date().getTime() : 0
    await SessionRepository.updateId(this)
  }

  async addMsg(msg: Message): Promise<void> {
    const wpMessage: WpMessage = {
      created_at: msg.timestamp,
      id: msg.id.id,
      type: msg.type,
      msg: msg.body,
      location: null,
      processed: false
    }

    if (msg.location) {
      const loc = msg.location as unknown as WpLocation
      wpMessage.location = {
        name: loc.name ?? MessageHelper.LOCATION_NO_NAME,
        lat: parseFloat(msg.location.latitude),
        lng: parseFloat(msg.location.longitude)
      }
    }

    await SessionRepository.addMsg(this.id, wpMessage)
    .then(async key => {
      if (wpMessage.type === MessageTypes.LOCATION) {
        this.messages.set(key, wpMessage)
        clearTimeout(this.processorTimeout)
        delete this.processorTimeout
        const unprocessedMessagesArray = Array.from(this.getUnprocessedMessages().values())
        await this.processMessage(wpMessage, unprocessedMessagesArray)
      } else {
        this.messages.set(key, wpMessage)
        await this.processUnprocessedMessages()
      }
    })
    .catch(e => console.log(e.message))
  }

  async processUnprocessedMessages(): Promise<void> {
    // TODO: move this to another Object
    let unprocessedMessages = this.getUnprocessedMessages()
    if (unprocessedMessages.size === 1 || (unprocessedMessages.size > 1 && !this.processorTimeout)) {
      this.processorTimeout = setTimeout(() => {
        const unprocessedMessagesArray = Array.from(this.getUnprocessedMessages().values())
        const text = unprocessedMessagesArray.map(msg => msg.msg).join(' ')
        const indexLast = unprocessedMessagesArray.length - 1
        const wpMsg: WpMessage = {
          created_at: unprocessedMessagesArray[indexLast].created_at,
          id: unprocessedMessagesArray[indexLast].id,
          type: unprocessedMessagesArray[indexLast].type,
          location: null,
          msg: text,
          processed: false
        }

        unprocessedMessagesArray.forEach(msg => {
          if (msg.location) {
            wpMsg.location = msg.location
            wpMsg.type = MessageTypes.LOCATION
          }
        })

        this.processMessage(wpMsg, unprocessedMessagesArray)
        clearTimeout(this.processorTimeout)
        delete this.processorTimeout
      }, 10000)
    }
  }

  async syncMessages(): Promise<void> {
    this.messages = await SessionRepository.getMessages(this.id)
    await this.processUnprocessedMessages()
  }

  private getUnprocessedMessages(): Map<string, WpMessage> {
    const unprocessedMessages = new Map<string, WpMessage>()

    this.messages.forEach((message) => {
      if (!message.processed) {
        unprocessedMessages.set(message.id, message)
      }
    })

    return unprocessedMessages
  }

  async setService(serviceID: string): Promise<void> {
    this.service_id = serviceID
    await SessionRepository.updateService(this)
  }
  
  async setStatus(status: string): Promise<void> {
    if (status === Session.STATUS_COMPLETED) {
      this.onCanceled
    }
    this.status = status
    await SessionRepository.updateStatus(this)
  }
  
  async setPlace(place: Place): Promise<void> {
    this.place = place
    await SessionRepository.updatePlace(this)
  }
  
  async setPlaceOptions(placeOptions: Array<PlaceOption>): Promise<void> {
    this.placeOptions = placeOptions
    await SessionRepository.updatePlaceOptions(this)
  }

  public setClient(client: Client): void {
    this.wpClient = client
  }

  async processMessage(message: WpMessage, unprocessedMessages: WpMessage[]): Promise<void> {
    const handler = ResponseContext.getResponse(this.status, this)
    const response = new ResponseContext(handler)
    await response.processMessage(message).then(async () => {
      await SessionRepository.setProcessedMsgs(this.id, unprocessedMessages).then(() => {
        unprocessedMessages.forEach(msg => {
          msg.processed = true
          this.messages.set(message.id, msg)
        })
      })
    })
  }
}