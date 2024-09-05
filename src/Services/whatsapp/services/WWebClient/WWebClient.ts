import {Client, LocalAuth, Message} from 'whatsapp-web.js'
import {WpEvents} from '../../constants/WpEvents'
import {WpStates} from '../../constants/WpStates'
import {WPClientInterface} from '../../interfaces/WPClientInterface'
import {WpChatInterface} from '../../interfaces/WpChatInterface'
import config from '../../../../../config'
import {WpClient} from '../../../../Interfaces/WpClient'
import {WpChatAdapter} from './Adapters/WpChatAdapter'
import {WpClients} from '../../constants/WPClients'
import {WpMessageAdapter} from "./Adapters/WpMessageAdapter";

export class WWebClient implements WPClientInterface {
  private client: Client
  private wpClient: WpClient
  static SESSION_PATH = 'storage/sessions/wweb-client/'
  serviceName = WpClients.WHATSAPP_WEB_JS

  constructor(wpClient: WpClient) {
    this.wpClient = wpClient
    const remotePath = `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${config.WWEB_VERSION}.html`
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.wpClient.id,
        dataPath: WWebClient.SESSION_PATH,
      }),
      qrMaxRetries: 2,
      takeoverOnConflict: false,
      webVersionCache: {
        type: 'remote',
        remotePath: remotePath,
      },
      puppeteer: {
        executablePath: config.CHROMIUM_PATH,
        headless: true,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--unhandled-rejections=strict',
          '--no-zygote',
        ],
      },
    })
  }

  getInfo(): string {
    return this.client.info?.pushname.toString()
  }

  getWWebVersion(): Promise<string> {
    return this.client.getWWebVersion()
  }

  initialize(): Promise<void> {
    return this.client.initialize()
  }

  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    this.client
      .sendMessage(phoneNumber, message)
      .then(() => {
        Promise.resolve()
      })
      .catch((e) => {
        Promise.reject(e)
      })
  }

  on(event: WpEvents, callback: (...args: any) => void): void {
    if (event === WpEvents.MESSAGE_RECEIVED) {
      this.client.on(WpEvents.MESSAGE_RECEIVED, (message: Message) => {
        const msg = new WpMessageAdapter(message)
        callback(msg)
      })
    } else {
      this.client.on(event, callback)
    }
  }

  async getState(): Promise<WpStates> {
    const state = await this.client.getState()
    return state as unknown as WpStates
  }

  async getChatById(chatId: string): Promise<WpChatInterface> {
    const chat = await this.client.getChatById(chatId)

    return new WpChatAdapter(chat)
  }

  logout(): Promise<void> {
    return this.client.logout()
  }
}
