import { WpClient } from '../../../../Interfaces/WpClient'
import config from '../../../../../config'
import { WpEvents } from '../../constants/WpEvents'
import { WpStates } from '../../constants/WpStates'
import { WPClientInterface } from '../../interfaces/WPClientInterface'
import { WpChatInterface } from '../../interfaces/WpChatInterface'
import { Config } from './Constants/Config'
import axios from 'axios'
import { WpClients } from '../../constants/WPClients'
import { Store } from '../../../store/Store'
import { WpChatAdapter } from './Adapters/WpChatAdapter'
import MessageRepository from '../../../../Repositories/MessageRepository'
import { MessageTypes } from '../../constants/MessageTypes'
import DateHelper from '../../../../Helpers/DateHelper'
import { ApiMessage } from './Constants/ApiMessage'
import { Interactive } from './Constants/Interactive'
import { ChatBotMessage } from '../../../../Types/ChatBotMessage'
import { MessagesEnum } from '../../../../Services/chatBot/MessagesEnum'
import QueueService from '../../../queue/QueueService'

export class OfficialClient implements WPClientInterface {
  private config: Config
  private status: WpStates
  private eventCallbacks: { [key: string]: Function[] } = {}
  serviceName: WpClients = WpClients.OFFICIAL
  private static instances: { [key: string]: OfficialClient } = {}
  private store: Store
  private msgQueue:QueueService = QueueService.getInstance()
  private QUEUE_NAME = WpClients.OFFICIAL + '-msg-queue'

  constructor(private wpClient: WpClient) {
    this.config = {
      apiKey: config.WAPI_TOKEN,
      apiUrl: config.WAPI_URL + wpClient.id + '/messages',
      timeout: 5000,
      messagingProduct: 'whatsapp',
    }

    this.store = Store.getInstance()
    this.store.getChats(wpClient.id)
    this.msgQueue.addQueue(this.QUEUE_NAME)
    this.msgQueue.addWorker(this.QUEUE_NAME, async (data: any) => {
      const { phoneNumber, message } = data
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await this.text(phoneNumber, message)
    })
  }

  getState(): Promise<WpStates> {
    return Promise.resolve(this.status)
  }

  logout(): Promise<void> {
    this.status = WpStates.UNPAIRED
    this.triggerEvent(WpEvents.DISCONNECTED)
    this.triggerEvent(WpEvents.AUTHENTICATED)
    return Promise.resolve()
  }

  public static getInstance(wpClient: WpClient): OfficialClient {
    if (!OfficialClient.instances[wpClient.id]) {
      OfficialClient.instances[wpClient.id] = new OfficialClient(wpClient)
    }

    return OfficialClient.instances[wpClient.id]
  }

  getInfo(): string {
    return this.status
  }

  getWWebVersion(): Promise<string> {
    return Promise.resolve('latest API')
  }

  async initialize(): Promise<void> {
    const msg: ChatBotMessage = {
      id: MessagesEnum.GREETING,
      message: 'Prueba de inicialización de whatsapp',
      name: 'Bot',
      enabled: true,
      description: 'Mensaje de prueba',
      interactive: null,
    }
    return await this.sendMessage('573103794656', msg).then(() => {
      this.status = WpStates.CONNECTED
      this.triggerEvent(WpEvents.AUTHENTICATED)
      this.triggerEvent(WpEvents.READY)
    })
  }

  private getInteractive(message: ChatBotMessage): Interactive | false {
    return message.interactive ?? false
  }

  async sendMessage(phoneNumber: string, message: ChatBotMessage): Promise<void> {
    this.msgQueue.add(this.QUEUE_NAME, { phoneNumber, message })
  }

  async text(phoneNumber: string, message: ChatBotMessage): Promise<void> {
    const phone = phoneNumber.replace('@c.us', '')
    return new Promise<void>(async (resolve, reject) => {      
      const interactive = this.getInteractive(message)
      let data: ApiMessage = {
        messaging_product: this.config.messagingProduct,
        to: phone,
        type: interactive? 'INTERACTIVE' : 'TEXT',
        text: {
          body: message.message,
        }
      }
      if (interactive) {
        data = { ...data, interactive }
      }

      const client = this.store.findClientById(phone)
      const chat = await this.store.getChatById(this.wpClient.id, client?.id ?? phone, client?.name)

      axios
        .post(this.config.apiUrl, data, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeout: this.config.timeout,
        })
        .then((response) => {
          const msgId = response.data.messages[0]?.id ?? DateHelper.unix()
          console.log('Message sent', msgId)
          MessageRepository.addMessage(this.wpClient.id, chat.id, {
            id: msgId,
            created_at: DateHelper.unix(),
            type: MessageTypes.TEXT,
            body: message.message,
            fromMe: true,
          })
          resolve()
        })
        .catch((error) => {
          console.log(error.response?.data)
          reject(error)
        })
    })
  }

  on(event: WpEvents, callback: (...args: any) => void): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = []
    }
    this.eventCallbacks[event].push(callback)
  }

  async getChatById(chatId: string): Promise<WpChatInterface> {
    const chat = await this.store.getChatById(this.wpClient.id, chatId)
    if (chat) {
      const wpChat = new WpChatAdapter(this, chat.id)
      return Promise.resolve(wpChat)
    } else {
      return Promise.reject('Chat not found')
    }
  }

  public triggerEvent(event: WpEvents, ...args: any[]): void {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach((callback) => callback(...args))
    }
  }
}
