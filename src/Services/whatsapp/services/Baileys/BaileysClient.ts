import { WpClient } from '../../../../Interfaces/WpClient'
import { WpEvents } from '../../constants/WpEvents'
import { WpStates } from '../../constants/WpStates'
import { WpChatInterface } from '../../interfaces/WpChatInterface'
import { WPClientInterface } from '../../interfaces/WPClientInterface'
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
  WAMessageKey,
  WAMessageContent,
  WAMessage,
  MessageUpsertType,
  proto,
  isJidBroadcast,
  isJidNewsletter,
  isPnUser,
  delay,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import P, { Logger } from 'pino'
import { WpChatAdapter } from './Adapters/WpChatAdapter'
import { WpMessageAdapter } from './Adapters/WPMessageAdapter'
import { MapCacheStore } from './MapCacheStore'
import { FileHelper } from '../../../../Helpers/FileHelper'
import { WpClients } from '../../constants/WPClients'
import config from '../../../../../config'
import { ChatBotMessage } from '../../../../Types/ChatBotMessage'
import QueueService from '../../../queue/QueueService'
import IgnoredInboundMessageAuditRepository from '../../../../Repositories/IgnoredInboundMessageAuditRepository'
import { renderInteractiveAsText } from '../../interactive/renderInteractiveAsText'

export class BaileysClient implements WPClientInterface {
  private clientSock: WASocket
  private eventCallbacks: { [key: string]: Function[] } = {}
  private state: AuthenticationState
  private logger: any
  private msgRetryCounterCache = new MapCacheStore()
  private static readonly SENT_MESSAGE_CACHE_LIMIT = 500
  private readonly sentMessages = new Map<string, proto.IMessage>()
  static SESSION_PATH = 'storage/sessions/baileys/'
  private attempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  serviceName: WpClients = WpClients.BAILEYS
  private status: WpStates = WpStates.UNPAIRED
  private QR: string | null = null
  private msgQueue = QueueService.getInstance()
  private QUEUE_NAME: string

  constructor(private wpClient: WpClient) {
    this.logger = P({
      level: config.NODE_ENV === 'production' ? 'error' : 'trace',
    }) as unknown as Logger
    this.QUEUE_NAME = WpClients.BAILEYS + '-msg-queue-' + this.wpClient.id
    this.msgQueue.addQueue(this.QUEUE_NAME)
    this.msgQueue.addWorker(this.QUEUE_NAME, async (data: any) => {
      const { phoneNumber, message } = data
      const waitTime = Math.random() * (5000 - 2000) + 2000
      await delay(waitTime)
      const sent = await this.clientSock.sendMessage(phoneNumber, {
        text: renderInteractiveAsText(message),
      })
      this.cacheSentMessage(sent?.key, sent?.message)
    })
  }

  async sendMessage(phoneNumber: string, message: ChatBotMessage): Promise<void> {
    this.msgQueue.add(this.QUEUE_NAME, { phoneNumber, message })
  }

  async sendTypingIndicator(chatId: string, inboundMessageId: string): Promise<void> {
    try {
      await this.clientSock.sendPresenceUpdate('composing', chatId)
    } catch (error: any) {
      this.logger.warn(
        { chatId, inboundMessageId, error: error?.message ?? error },
        'Failed to send composing presence update'
      )
    }
  }

  on(event: WpEvents, callback: (...arg: any) => void): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = []
    }
    this.eventCallbacks[event].push(callback)
  }

  removeAllListeners(): void {
    this.eventCallbacks = {}
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
    this.clearReconnectTimer()
    await this.clientSock.logout()
    FileHelper.removeFolder(BaileysClient.SESSION_PATH + this.wpClient.id)

    return Promise.resolve()
  }

  async initialize(): Promise<void> {
    if (this.status === WpStates.CONNECTED) {
      return Promise.resolve()
    }
    const { state, saveCreds } = await useMultiFileAuthState(
      BaileysClient.SESSION_PATH + this.wpClient.id
    )
    this.state = {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, this.logger),
    }

    const { version } = await fetchLatestBaileysVersion()

    this.clientSock = makeWASocket({
      version: version,
      auth: this.state,
      logger: this.logger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      mobile: false,
      msgRetryCounterCache: this.msgRetryCounterCache,
      maxMsgRetryCount: 3,
      keepAliveIntervalMs: 15000,
      retryRequestDelayMs: 1500,
      markOnlineOnConnect: true,
      shouldIgnoreJid: (jid?: string) => !jid || isJidBroadcast(jid) || isJidNewsletter(jid),
      defaultQueryTimeoutMs: 3000,
      connectTimeoutMs: 20000,
      syncFullHistory: false,
      getMessage: this.getMessage,
    })

    this.clientSock.ev.on('creds.update', saveCreds)

    this.clientSock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr, isOnline } = update

      console.log('***** Connection *****')
      console.table(update)

      if (connection === 'close') {
        this.QR = null
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        console.log('Connection closed due to', lastDisconnect?.error)
        this.triggerEvent(WpEvents.AUTHENTICATION_FAILURE)
        this.status = WpStates.UNPAIRED

        if (statusCode === DisconnectReason.loggedOut) {
          this.clearReconnectTimer()
          this.triggerEvent(WpEvents.DISCONNECTED)
          FileHelper.removeFolder(BaileysClient.SESSION_PATH + this.wpClient.id)
          console.log('Not reconnecting, logged out')
          return
        }

        this.status = WpStates.OPENING
        this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.OPENING)

        if (statusCode === DisconnectReason.restartRequired) {
          console.log('Restart required, reconnecting immediately')
          this.scheduleReconnect(0)
          return
        }

        const backoffMs = Math.min(3000 * 2 ** this.attempt, 60000)
        this.attempt++
        console.log('Reconnecting in', backoffMs, 'ms, attempt', this.attempt)
        this.scheduleReconnect(backoffMs)
      } else if (connection === 'connecting') {
        this.status = WpStates.OPENING
        this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.OPENING)
      } else if (connection === 'open') {
        this.QR = null
        console.log('Connected to socket successfully')
        this.status = WpStates.CONNECTED
        this.attempt = 0
        this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.CONNECTED)
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
        this.triggerEvent(WpEvents.STATE_CHANGED, WpStates.CONNECTED)
        this.triggerEvent(WpEvents.READY)
        this.triggerEvent(WpEvents.AUTHENTICATED)
      }
    })

    this.clientSock.ev.on(
      'messages.upsert',
      async (message: { messages: WAMessage[]; type: MessageUpsertType }) => {
        const waMessage = message.messages[0]
        if (!this.isValidMessage(waMessage, message.type)) {
          return
        }

        const phoneNumberJid = await this.resolveSenderPhoneNumberJid(waMessage.key)
        if (!phoneNumberJid) {
          await this.recordUnresolvedSender(waMessage)
          return
        }

        const from = phoneNumberJid.replace('@s.whatsapp.net', '@c.us')
        const msg = new WpMessageAdapter(waMessage, this.clientSock, from)
        this.triggerEvent(WpEvents.MESSAGE_RECEIVED, msg)
      }
    )
  }

  // Design D5: resolves the customer's phone-number JID before the (synchronous)
  // WpMessageAdapter is built, trying remoteJid, then remoteJidAlt, then the
  // library's LID-to-PN mapping. Returns null when none of those yields a PN.
  private async resolveSenderPhoneNumberJid(key: WAMessageKey): Promise<string | null> {
    if (key.remoteJid && isPnUser(key.remoteJid)) {
      return key.remoteJid
    }
    if (key.remoteJidAlt && isPnUser(key.remoteJidAlt)) {
      return key.remoteJidAlt
    }
    if (!key.remoteJid) {
      return null
    }
    return this.clientSock.signalRepository.lidMapping.getPNForLID(key.remoteJid)
  }

  // Design D5: a LID with no alternate JID and no known mapping is skipped rather
  // than dispatched under a LID-keyed sender, which would poison `clients`.
  private async recordUnresolvedSender(message: WAMessage): Promise<void> {
    const wpClientId = this.wpClient.id
    const messageId = message.key.id ?? 'unknown'
    const remoteJid = message.key.remoteJid ?? null

    this.logger.warn(
      { wpClientId, messageId, remoteJid },
      'Unable to resolve inbound sender phone number'
    )

    await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
      wpClientId,
      provider: this.serviceName,
      messageId,
      chatId: remoteJid,
      rawTimestamp: message.messageTimestamp != null ? String(message.messageTimestamp) : null,
      messageType: null,
      reason: 'unresolved_sender',
    })
  }

  // Stores the timer handle (design D7/D12) so a future `destroy()`
  // (fix-wp-reset-per-line task 1.3) can cancel a pending reconnect.
  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => this.initialize(), delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private isValidMessage(message: WAMessage, type: MessageUpsertType): boolean {
    return (
      !message.key.fromMe &&
      !message.key.remoteJid?.includes('g.us') &&
      !message.broadcast &&
      type === 'notify'
    )
  }

  getInfo(): string {
    return this.clientSock?.user?.name || ''
  }

  private triggerEvent(event: WpEvents, ...args: any[]): void {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach((callback) => callback(...args))
    }
  }

  // Bounded, insertion-ordered cache of messages this client has sent (design D6):
  // replaces the on-disk store solely for the library's delivery-retry lookups.
  private cacheSentMessage(key?: WAMessageKey, message?: proto.IMessage | null): void {
    if (!key?.id || !message) {
      return
    }
    this.sentMessages.set(this.sentMessageCacheKey(key), message)
    if (this.sentMessages.size > BaileysClient.SENT_MESSAGE_CACHE_LIMIT) {
      const oldestKey = this.sentMessages.keys().next().value
      if (oldestKey !== undefined) {
        this.sentMessages.delete(oldestKey)
      }
    }
  }

  private sentMessageCacheKey(key: WAMessageKey): string {
    return `${key.remoteJid ?? ''}:${key.id ?? ''}`
  }

  // Declared as an arrow function (class field) so it stays bound to this instance's
  // cache even though `makeWASocket` invokes it detached from `this` (design D6).
  private getMessage = async (key: WAMessageKey): Promise<WAMessageContent | undefined> => {
    return this.sentMessages.get(this.sentMessageCacheKey(key))
  }
}
