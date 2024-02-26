import {SessionInterface} from '../Interfaces/SessionInterface'
import SessionRepository from '../Repositories/SessionRepository'
import {PlaceOption} from '../Interfaces/PlaceOption'
import Place from './Place'
import {WpMessage} from '../Types/WpMessage'
import {WpMessageMap} from '../Types/WpMessageMap'
import {ResponseContext} from '../Services/chatBot/MessageStrategy/ResponseContext'
import {Client, Message} from 'whatsapp-web.js'

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
  public messages: WpMessageMap = {}
  public wpClient: Client
  private interval: NodeJS.Timer

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
  
  isCompleted(): boolean {
    return this.status === Session.STATUS_COMPLETED
  }

  async setAssigned(assigned: boolean = true): Promise<void> {
    this.assigned_at = assigned ? new Date().getTime() : 0
    await SessionRepository.updateId(this)
  }

  async addMsg(msg: Message): Promise<void> {
    const wpMessage: WpMessage = {
      id: msg.id.id,
      type: msg.type,
      msg: msg.body,
      location: msg.location,
      processed: false
    }

    await SessionRepository.addMsg(this.id, wpMessage)
    .then(key => {
      this.messages[key] = wpMessage

      const unprocessedMessages = this.getUnprocessedMessages()

      if (unprocessedMessages.size == 1) {
        this.interval = setTimeout(() => {
          let text: string = ''
          let wpMsg: WpMessage = wpMessage
          const messages = this.getUnprocessedMessages()
          messages.forEach((msg) => {
            text += msg.msg + ' '
            wpMsg = {
              id: msg.id,
              type: msg.type,
              location: msg.location,
              msg: text,
              processed: false
            }
          })

          this.processMessages(wpMsg)
        }, 10000)
      }


    })
    .catch(e => console.log(e.message))
  }

  private getUnprocessedMessages(): Map<string, WpMessage> {
    const unprocessedMessages = new Map<string, WpMessage>()

    Object.entries(this.messages).forEach(([key, message]) => {
      if (!message.processed) {
        unprocessedMessages.set(key, message)
      }
    })

    return unprocessedMessages
  }

  async setService(serviceID: string): Promise<void> {
    this.service_id = serviceID
    await SessionRepository.updateService(this)
  }
  
  async setStatus(status: string): Promise<void> {
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

  async processMessages(message: WpMessage): Promise<void> {
    const status = this.status as keyof typeof ResponseContext.RESPONSES
    const handler = new ResponseContext.RESPONSES[status](this)
    const response = new ResponseContext(handler)
    await response.processMessage(message)
  }
}