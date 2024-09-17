import { WpClient } from '../../../../Interfaces/WpClient'
import { WpEvents } from '../../constants/WpEvents'
import { WpStates } from '../../constants/WpStates'
import { WpChatInterface } from '../../interfaces/WpChatInterface'
import { WPClientInterface } from '../../interfaces/WPClientInterface'
import NodeCache from 'node-cache'
import {
  default as makeWASocket,
  DisconnectReason,
  ConnectionState,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  AuthenticationState,
  Browsers,
  WASocket,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  WAMessageKey,
  WAMessageContent,
  WAMessage,
  MessageUpsertType,
  proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import P, { Logger } from 'pino'
import { WpChatAdapter } from './Adapters/WpChatAdapter'
import { WpMessageAdapter } from './Adapters/WPMessageAdapter'
import { FileHelper } from '../../../../Helpers/FileHelper'
import { WpClients } from '../../constants/WPClients'

export class BaileysClient implements WPClientInterface {
  private clientSock: WASocket
  private eventCallbacks: { [key: string]: Function[] } = {}
  private state: AuthenticationState
  private logger: any
  private store: any
  static SESSION_PATH = 'storage/sessions/baileys/'
  private retries = 0
  private interval: NodeJS.Timer
  serviceName: WpClients = WpClients.BAILEYS
  private status: WpStates = WpStates.UNPAIRED
  private QR: string|null = null

  constructor(private wpClient: WpClient) {
    this.logger = P({ level: 'error' }) as unknown as Logger
  }

  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    await this.clientSock.sendMessage(phoneNumber, { text: message })
  }

  on(event: WpEvents, callback: (...arg: any) => void): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = []
    }
    this.eventCallbacks[event].push(callback)
  }

  async getWWebVersion(): Promise<string> {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    return Promise.resolve(`v${version}, is Latest: ${isLatest}`)
  }

  getState(): Promise<WpStates> {
    if (this.status === WpStates.OPENING && this.QR) {
      setTimeout(() => this.triggerEvent(WpEvents.QR_RECEIVED, this.QR), 2000)
    }
    return Promise.resolve(this.status)
  }

  getChatById(chatId: string): Promise<WpChatInterface> {
    return Promise.resolve(new WpChatAdapter(this.clientSock, chatId))
  }

  async logout(): Promise<void> {
    await this.clientSock.logout()
    clearInterval(this.interval)
    FileHelper.removeFolder(BaileysClient.SESSION_PATH + this.wpClient.id)

    return Promise.resolve()
  }

  private initCache(): void {
    this.interval = setInterval(() => {
      this.store.writeToFile(BaileysClient.SESSION_PATH + this.wpClient.id + '/store.json')
    }, 10000)
  }

  async initialize(): Promise<void> {
    this.retries++
    const { state, saveCreds } = await useMultiFileAuthState(BaileysClient.SESSION_PATH + this.wpClient.id)
    this.state = {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, this.logger),
    }

    if (this.retries == 1) {
      this.initCache()
    }

    this.store = makeInMemoryStore({ logger: this.logger })

    const { version } = await fetchLatestBaileysVersion()

    this.clientSock = makeWASocket({
      version: version,
      auth: this.state,
      logger: this.logger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      mobile: false,
      msgRetryCounterCache: new NodeCache({ stdTTL: 60, checkperiod: 120 }),
      maxMsgRetryCount: 2,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 2000,
      markOnlineOnConnect: true,
      defaultQueryTimeoutMs: 2000,
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification) => false,
      getMessage: this.getMessage,
    })

    this.store.bind(this.clientSock.ev)

    this.clientSock.ev.on('creds.update', saveCreds)

    this.clientSock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr, isOnline } = update

      console.log('Connection *****');
      console.table(update)

      if (connection === 'close') {
        this.QR = null
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output.statusCode !== DisconnectReason.loggedOut && this.retries <= 2
        console.log('Connection closed due to', lastDisconnect?.error, 'Reconnecting:', shouldReconnect)
        this.triggerEvent(WpEvents.AUTHENTICATION_FAILURE)
        this.status = WpStates.UNPAIRED
        if (shouldReconnect || (lastDisconnect?.error as Boom)?.output.statusCode === DisconnectReason.restartRequired) {
          console.log('Restart required')
          this.status = WpStates.OPENING
          this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.OPENING)
          setTimeout(() => this.initialize(), 3000)
        } else {
          this.triggerEvent(WpEvents.DISCONNECTED)
          clearInterval(this.interval)
          FileHelper.removeFolder(BaileysClient.SESSION_PATH + this.wpClient.id)
          console.log('Not reconnecting, loggedout')
        }
      } else if (connection === 'connecting') {
        this.status = WpStates.OPENING
        this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.OPENING)
      } else if (connection === 'open') {
        this.QR = null
        console.log('Connected to socket successfully')
        this.status = WpStates.CONNECTED
        this.triggerEvent(WpEvents.READY)
        this.triggerEvent(WpEvents.AUTHENTICATED)
      } else if (qr) {
        this.QR = qr
        if (this.status === WpStates.CONNECTED) {
          console.log('QR Received when already connected, skipping')
        } else {
          this.triggerEvent(WpEvents.QR_RECEIVED, qr)
          this.status = WpStates.OPENING
        }
      }

      if (isOnline) {
        this.QR = null
        this.status = WpStates.CONNECTED
      }
    })

    this.clientSock.ev.on('messages.upsert', async (message: { messages: WAMessage[]; type: MessageUpsertType }) => {
      if (this.isValidMessage(message.messages[0], message.type)) {
        const msg = new WpMessageAdapter(message.messages[0], this.clientSock)
        this.triggerEvent(WpEvents.MESSAGE_RECEIVED, msg)
      }
    })
  }

  private isValidMessage(message: WAMessage, type: MessageUpsertType): boolean {
    return !message.key.fromMe && !message.key.remoteJid?.includes('g.us') && !message.broadcast && type === 'notify'
  }

  getInfo(): string {
    return this.clientSock?.user?.name || ''
  }

  private triggerEvent(event: WpEvents, ...args: any[]): void {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach((callback) => callback(...args))
    }
  }

  private async getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
    const msg = await this.store.loadMessage(key.remoteJid!, key.id!)
    return msg?.message || undefined
  }
}
