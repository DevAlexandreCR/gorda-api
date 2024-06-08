import { WpClient } from '../../../../Interfaces/WpClient'
import config from '../../../../../config'
import { WpEvents } from '../../constants/WpEvents'
import { WpStates } from '../../constants/WpStates'
import { WPClientInterface } from '../../interfaces/WPClientInterface'
import { WpChatInterface } from '../../interfaces/WpChatInterface'
import { Config } from './Constants/Config'
import axios from 'axios'
import { WpClients } from '../../constants/WPClients'

export class OfficialClient implements WPClientInterface {
  private config: Config
  private status: WpStates
  private eventCallbacks: { [key: string]: Function[] } = {}
  serviceName = WpClients.OFFICIAL

  constructor(private wpClient: WpClient) {
    this.config = {
      apiKey: config.WAPI_TOKEN,
      apiUrl: config.WAPI_URL + wpClient.id + '/messages',
      timeout: 3000,
      messagingProduct: 'whatsapp',
    }
  }

  getInfo(): string {
    return this.status
  }

  getWWebVersion(): Promise<string> {
    return Promise.resolve('latest API')
  }

  async initialize(): Promise<void> {
    return await this.sendMessage('+573103794656', 'Prueba de inicialización de whatsapp').then(() => {
      this.status = WpStates.CONNECTED
      this.triggerEvent(WpEvents.AUTHENTICATED)
      this.triggerEvent(WpEvents.READY)
    })
  }

  sendMessage(phoneNumber: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = {
        messaging_product: this.config.messagingProduct,
        to: phoneNumber.replace('@c.us', ''),
        type: 'text',
        text: {
          body: message,
        },
      }

      axios
        .post(this.config.apiUrl, data, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeout: this.config.timeout,
        })
        .then((response) => {
          console.log(response.data)
          resolve()
        })
        .catch((error) => {
          console.log(error.response?.data)

          reject(error)
        })
    })
  }

  receiveMessage(phoneNumber: string): string {
    return 'Message received'
  }

  on(event: WpEvents, callback: (...args: any) => void): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = []
    }
    this.eventCallbacks[event].push(callback)
  }

  getState(): Promise<WpStates> {
    return Promise.resolve(this.status)
  }

  getChatById(chatId: string): Promise<WpChatInterface> {
    throw new Error('Method not implemented.')
  }

  logout(): Promise<void> {
    this.status = WpStates.PAIRING
    this.triggerEvent(WpEvents.AUTHENTICATED)

    return Promise.resolve()
  }

  private triggerEvent(event: WpEvents, ...args: any[]): void {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach((callback) => callback(...args))
    }
  }
}
