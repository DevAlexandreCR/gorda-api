import * as Sentry from '@sentry/node'
import { Server as SocketIOServer } from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import { DataSnapshot } from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import { Store } from '../store/Store'
import config from '../../../config'
import { WpNotificationType } from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'
import { EmitEvents } from './EmitEvents'
import { LoadingType } from '../../Interfaces/LoadingType'
import SettingsRepository from '../../Repositories/SettingsRepository'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import { WpClient } from '../../Interfaces/WpClient'
import Session from '../../Models/Session'
import { ServiceInterface } from '../../Interfaces/ServiceInterface'
import { NotificationType } from '../../Types/NotificationType'
import { MessagesEnum } from '../chatBot/MessagesEnum'
import { ChatBotMessage } from '../../Types/ChatBotMessage'
import { WpStates } from './constants/WpStates'
import { WpEvents } from './constants/WpEvents'
import { WPClientInterface } from './interfaces/WPClientInterface'
import { WpMessageInterface } from './interfaces/WpMessageInterface'
import { ClientFactory } from './ClientFactory'
import { WpClients } from './constants/WPClients'
import { MessageTypes } from './constants/MessageTypes'
import { spawn } from 'child_process'
import MessageHelper from '../../Helpers/MessageHelper'
import DateHelper from '../../Helpers/DateHelper'
import InboundMessageMetrics from './monitoring/InboundMessageMetrics'
import { InboundMessagePolicy } from './policies/InboundMessagePolicy'
import InboundMessageDedupCache from './policies/InboundMessageDedupCache'
import IgnoredInboundMessageAuditRepository from '../../Repositories/IgnoredInboundMessageAuditRepository'
import ChatIdHelper from '../../Helpers/ChatIdHelper'
import MessageRepository from '../../Repositories/MessageRepository'
import DatabaseService from '../firebase/Database'
import { VehicleSnapshot } from '../chatBot/Messages'
import { resolveDriverCurrentVehicle } from '../drivers/DriverVehicleResolver'

export class WhatsAppClient {
  public client: WPClientInterface
  private socket: SocketIOServer | null = null
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
  private wpClient: WpClient
  public deleting = false
  public starting = false

  constructor(client: WpClient) {
    this.wpClient = client
  }

  initClient(): void {
    this.client = ClientFactory.build(this.wpClient)
    this.client.on(WpEvents.QR_RECEIVED, this.onQR)
    this.client.on(WpEvents.READY, this.onReady)
    this.client.on(WpEvents.AUTHENTICATED, this.onAuth)
    this.client.on(WpEvents.AUTHENTICATION_FAILURE, this.onAuthFailure)
    this.client.on(WpEvents.STATE_CHANGED, this.onStateChanged)
    this.client.on(WpEvents.DISCONNECTED, this.onDisconnected)
    this.client.on(WpEvents.LOADING_SCREEN, this.onLoadingScreen)
    this.client.on(WpEvents.MESSAGE_RECEIVED, this.onMessageReceived)

    this.init(false)
      .then(async () => {
        this.client
          .getWWebVersion()
          .then((version) => console.log('wweb version', version))
          .catch((e) => console.log('Error getting the version', e.message))
        console.log('authenticated after init server', this.wpClient.alias)
        this.starting = false
      })
      .catch((e) => {
        this.starting = false
        console.log(e.message)
        Sentry.captureException(e)
        if (this.client.serviceName === WpClients.WHATSAPP_WEB_JS) {
          return this.restartChromium()
        }
      })
  }

  setSocket(socket: SocketIOServer): void {
    this.socket = socket
  }

  thereIsSocket(): boolean {
    return this.socket !== null
  }

  onReady = (): void => {
    WpNotificationRepository.offNotifications(this.wpClient.id)
    this.chatBot = new ChatBot(this.client, this.wpClient.id)
    this.chatBot.sync()
    WpNotificationRepository.onServiceAssigned(this.wpClient.id, this.serviceAssigned)
    WpNotificationRepository.onDriverArrived(this.wpClient.id, this.driverArrived)
    WpNotificationRepository.onNewService(this.wpClient.id, this.onNewService)
    WpNotificationRepository.onServiceCanceled(this.wpClient.id, this.serviceCanceled)
    WpNotificationRepository.onServiceTerminated(this.wpClient.id, this.serviceTerminated)
    ServiceRepository.onServiceChanged(this.serviceChanged)
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.READY)
    console.log(this.client.getInfo())
  }

  onQR = (qr: string): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.QR_RECEIVED, qr)
    console.log('sending qr code..', this.wpClient.alias, qr)
  }

  onAuth = (): void => {
    console.log('authentication successfully!', this.wpClient.alias)
  }

  onMessageReceived = async (msg: WpMessageInterface): Promise<void> => {
    console.log(
      'Message received',
      this.wpClient.alias,
      msg.type,
      msg.from,
      msg.body.substring(0, 50)
    )

    if (this.client.serviceName !== WpClients.OFFICIAL) {
      const shouldProcess = await this.shouldProcessInboundMessage(msg)
      if (!shouldProcess) return
    }

    if (this.wpClient.full) {
      await this.sendMessage(msg.from, Messages.getSingleMessage(MessagesEnum.FULL_CLIENT)).catch(
        (e) =>
          console.log(
            'sendMessage FULL_CLIENT Error',
            this.wpClient.alias,
            msg.from,
            JSON.stringify(e)
          )
      )
    } else {
      if (this.client.serviceName !== WpClients.OFFICIAL) {
        const chat = await msg.getChat()
        const contact = await chat.getContact().catch(() => null)
        const normalizedChatId = ChatIdHelper.normalize(msg.from)
        const profileName =
          contact?.pushname ||
          this.store.findClientById(normalizedChatId)?.name ||
          `Chat ${normalizedChatId}`
        const storedChat = await this.store.getChatById(this.wpClient.id, msg.from, profileName)

        await MessageRepository.addMessage(
          this.wpClient.id,
          storedChat.id,
          {
            id: msg.id,
            created_at: msg.timestamp,
            type: msg.type,
            body:
              msg.type === MessageTypes.INTERACTIVE
                ? (msg.interactiveReply?.button_reply?.id ?? msg.body)
                : msg.body,
            fromMe: false,
            location: msg.location ?? null,
            interactive: null,
            interactiveReply: msg.interactiveReply,
          },
          {
            clientName: profileName,
            processed: false,
          }
        )
      }

      if (this.isProcessableMsg(msg)) {
        await this.chatBot.processMessage(msg).catch((e) => console.log(e.message))
      }
    }
  }

  private async shouldProcessInboundMessage(msg: WpMessageInterface): Promise<boolean> {
    const messageId = this.resolveInboundMessageId(msg.id)
    const provider = this.client.serviceName
    const policyDecision = InboundMessagePolicy.evaluate(msg.timestamp)
    const maxAgeMinutes = Number(config.INBOUND_MESSAGE_MAX_AGE_MINUTES) || 120

    if (
      policyDecision.reason === 'invalid_timestamp_processed' ||
      policyDecision.reason === 'future_timestamp_processed'
    ) {
      InboundMessageMetrics.increment({
        provider,
        wpClientId: this.wpClient.id,
        reason: policyDecision.reason,
      })
      console.log(
        '[InboundMessageTimestampAnomaly]',
        JSON.stringify({
          provider,
          wpClientId: this.wpClient.id,
          messageId,
          from: msg.from,
          reason: policyDecision.reason,
          rawTimestamp: msg.timestamp ?? null,
          normalizedTimestamp: policyDecision.normalizedTimestamp,
          ageMinutes: policyDecision.ageMinutes,
          maxAgeMinutes,
          at: new Date().toISOString(),
        })
      )
    }

    if (policyDecision.action === 'ignore') {
      InboundMessageMetrics.increment({
        provider,
        wpClientId: this.wpClient.id,
        reason: 'old_message',
      })
      await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
        wpClientId: this.wpClient.id,
        provider,
        messageId,
        chatId: msg.from,
        rawTimestamp: msg.timestamp ?? null,
        messageType: msg.type,
        reason: 'old_message',
        messageAgeMinutes: policyDecision.ageMinutes,
        messageTimestamp: policyDecision.normalizedTimestamp,
      })
      console.log(
        '[InboundMessageIgnored]',
        JSON.stringify({
          provider,
          wpClientId: this.wpClient.id,
          messageId,
          from: msg.from,
          reason: 'old_message',
          rawTimestamp: msg.timestamp ?? null,
          normalizedTimestamp: policyDecision.normalizedTimestamp,
          ageMinutes: policyDecision.ageMinutes,
          maxAgeMinutes,
          at: new Date().toISOString(),
        })
      )
      return false
    }

    const dedupDecision = await InboundMessageDedupCache.evaluate(this.wpClient.id, messageId)
    if (dedupDecision.action === 'ignore') {
      InboundMessageMetrics.increment({
        provider,
        wpClientId: this.wpClient.id,
        reason: 'duplicate_message',
      })
      await IgnoredInboundMessageAuditRepository.recordIgnoredEvent({
        wpClientId: this.wpClient.id,
        provider,
        messageId,
        chatId: msg.from,
        rawTimestamp: msg.timestamp ?? null,
        messageType: msg.type,
        reason: 'duplicate_message',
        messageAgeMinutes: policyDecision.ageMinutes,
        messageTimestamp: policyDecision.normalizedTimestamp,
      })
      console.log(
        '[InboundMessageIgnored]',
        JSON.stringify({
          provider,
          wpClientId: this.wpClient.id,
          messageId,
          from: msg.from,
          reason: 'duplicate_message',
          rawTimestamp: msg.timestamp ?? null,
          normalizedTimestamp: policyDecision.normalizedTimestamp,
          ageMinutes: policyDecision.ageMinutes,
          maxAgeMinutes,
          at: new Date().toISOString(),
        })
      )
      return false
    }

    await InboundMessageDedupCache.recordProcessed(this.wpClient.id, messageId, provider)

    return true
  }

  private resolveInboundMessageId(messageId?: string): string {
    if (messageId && messageId.trim()) return messageId.trim()
    return `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  isProcessableMsg(msg: WpMessageInterface): boolean {
    // Reject stickers and courtesy-only text messages
    if (msg.type == MessageTypes.STICKER) return false
    if (msg.type == MessageTypes.TEXT && MessageHelper.isCourtesyMessage(msg.body)) return false

    const session = this.chatBot.findSessionByChatId(msg.from)
    if (session && this.isMessageTypeSupported(msg.type)) return true
    if (this.wpClient.assistant) return msg.type === MessageTypes.LOCATION
    if (this.wpClient.chatBot) {
      return (
        msg.type == MessageTypes.LOCATION ||
        (msg.type == MessageTypes.TEXT && !msg.isStatus && !msg.from.includes('-'))
      )
    }

    return false
  }

  isMessageTypeSupported(msgType: MessageTypes): boolean {
    return (
      msgType === MessageTypes.TEXT ||
      msgType === MessageTypes.LOCATION ||
      msgType === MessageTypes.INTERACTIVE
    )
  }

  onDisconnected = async (reason: string | WpStates): Promise<void> => {
    console.log('Client disconnected ', this.wpClient.alias, reason)
    if (!this.deleting) {
      await SettingsRepository.enableWpNotifications(this.wpClient.id, false)
    }
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.DISCONNECTED, reason)
    if (reason === EmitEvents.NAVIGATION)
      await this.client.logout().catch((e) => {
        WpNotificationRepository.offNotifications(this.wpClient.id)
        console.log('destroy ', this.wpClient.alias, e.message)
        this.socket?.emit(EmitEvents.FAILURE, e.message)
        Sentry.captureException(e)
        if (this.client.serviceName === WpClients.WHATSAPP_WEB_JS) {
          return this.restartChromium()
        }
      })
  }

  onAuthFailure = (message: string): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.AUTHENTICATION_FAILURE, message)
    console.log(WpEvents.AUTHENTICATION_FAILURE, this.wpClient.alias, message)
  }

  onLoadingScreen = (percent: string, message: string): void => {
    const loading: LoadingType = {
      percent: percent,
      message: message,
    }
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.LOADING_SCREEN, loading)
    console.log(WpEvents.LOADING_SCREEN, this.wpClient.alias, percent, message)
  }

  onStateChanged = (waState: WpStates): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, waState)
    console.log(WpEvents.STATE_CHANGED, this.wpClient.alias, waState)
  }

  init = async (web = true): Promise<void> => {
    this.starting = true
    console.log('initializing whatsapp client...', this.wpClient.alias)
    if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WpStates.OPENING)
    return this.client.initialize()
  }

  getState = (): void => {
    this.client
      .getState()
      .then((state) => {
        if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, state)
      })
      .catch((e) => {
        console.log(EmitEvents.GET_STATE, this.wpClient.alias, e.message)
        if (this.socket)
          this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WpStates.UNPAIRED)
      })
  }

  serviceAssigned = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    if (notification.driver_id != null && notification.wp_client_id == this.wpClient.id) {
      const serviceId = snapshot.key ?? ''
      const vehicle = await this.readServiceVehicleSnapshot(serviceId)
      const msg = Messages.serviceAssigned(vehicle)
      if (msg.enabled) {
        await this.sendMessage(notification.client_id, msg).then(() => {
          WpNotificationRepository.deleteNotification('assigned', serviceId)
        })
      } else {
        await WpNotificationRepository.deleteNotification('assigned', serviceId)
      }
    } else {
      console.error('can not send message cause driver id is not set', notification, this.wpClient)
    }
  }

  private readServiceVehicleSnapshot = async (serviceId: string): Promise<VehicleSnapshot> => {
    try {
      const vehicleSnap = await DatabaseService.dbServices().child(serviceId).child('vehicle').get()
      if (vehicleSnap.exists()) {
        const v = vehicleSnap.val() as {
          plate?: string
          color?: { name: string; hex?: string } | null
        }
        if (v?.plate) {
          return { plate: v.plate, color: v.color ?? null }
        }
      }
    } catch (e) {
      console.error('readServiceVehicleSnapshot error', serviceId, e)
    }
    // fallback: read from driver in store (pre-snapshot-era services or missing snapshot)
    const serviceSnap = await DatabaseService.dbServices().child(serviceId).get()
    const driverId: string | null = serviceSnap.exists()
      ? (serviceSnap.val()?.driver_id ?? null)
      : null
    if (driverId) {
      const vehicle = await resolveDriverCurrentVehicle(driverId)
      return { plate: vehicle?.plate ?? '', color: vehicle?.color ?? null }
    }
    return { plate: '', color: null }
  }

  driverArrived = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    const msg = Messages.getSingleMessage(MessagesEnum.DRIVER_ARRIVED)
    if (msg.enabled) {
      await this.sendMessage(notification.client_id, msg).then(() => {
        WpNotificationRepository.deleteNotification('arrived', snapshot.key ?? '')
      })
    } else {
      await WpNotificationRepository.deleteNotification('arrived', snapshot.key ?? '')
    }
  }

  serviceCanceled = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    const msg = Messages.getSingleMessage(MessagesEnum.CANCELED)
    if (msg.enabled) {
      await this.sendMessage(notification.client_id, msg).then(() => {
        WpNotificationRepository.deleteNotification(Service.STATUS_CANCELED, snapshot.key ?? '')
      })
    } else {
      await WpNotificationRepository.deleteNotification(Service.STATUS_CANCELED, snapshot.key ?? '')
    }
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    const msg = Messages.completedService()
    if (msg.enabled) {
      await this.sendMessage(notification.client_id, msg).then(() => {
        WpNotificationRepository.deleteNotification(Service.STATUS_TERMINATED, snapshot.key ?? '')
      })
    } else {
      await WpNotificationRepository.deleteNotification(
        Service.STATUS_TERMINATED,
        snapshot.key ?? ''
      )
    }
  }

  onNewService = async (snapshot: DataSnapshot): Promise<void> => {
    setTimeout(async () => {
      const notification: WpNotificationType = snapshot.val()
      this.cancelTimeout(snapshot.key!!, notification.client_id)
      const msg = Messages.getSingleMessage(MessagesEnum.SERVICE_CREATED)
      if (msg.enabled) {
        await this.sendMessage(notification.client_id, msg).then(() => {
          WpNotificationRepository.deleteNotification('new', snapshot.key ?? '')
        })
      } else {
        await WpNotificationRepository.deleteNotification('new', snapshot.key ?? '')
      }
    }, 2000)
  }

  cancelTimeout = (serviceId: string, clientId: string): void => {
    setTimeout(async () => {
      await ServiceRepository.findServiceStatusById(serviceId)
        .then(async (status) => {
          if (status === Service.STATUS_PENDING) {
            const msg = Messages.getSingleMessage(MessagesEnum.ASK_FOR_CANCEL)
            if (msg.enabled) {
              await this.sendMessage(clientId, msg)
            }
          }
        })
        .catch((e) => console.log('cancelTimeout Error', this.wpClient.alias, e.message))
    }, config.CANCEL_TIMEOUT as number)
  }

  logout = async (): Promise<void> => {
    await this.client
      .logout()
      .then(async () => {
        console.log('logout successfully', this.wpClient.alias)
        WpNotificationRepository.offNotifications(this.wpClient.id)
        if (this.socket) this.socket.to(this.wpClient.id).emit('destroy')
      })
      .catch((e) => {
        console.log('logout: ', this.wpClient.alias, e)
        Sentry.captureException(e)
        if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.FAILURE, e.message)
        if (this.client.serviceName === WpClients.WHATSAPP_WEB_JS) {
          return this.restartChromium()
        }
      })
  }

  setWpClient(client: WpClient): void {
    this.wpClient.wpNotifications = client.wpNotifications
    this.wpClient.chatBot = client.chatBot
    this.wpClient.assistant = client.assistant
    this.wpClient.service = client.service ?? WpClients.WHATSAPP_WEB_JS
    this.wpClient.full = client.full
  }

  serviceChanged = async (snapshot: DataSnapshot): Promise<void> => {
    if (!this.wpClient.chatBot && !this.wpClient.assistant) return Promise.resolve()
    const service = new Service()
    Object.assign(service, snapshot.val() as ServiceInterface)

    let session = this.chatBot.findSessionByChatId(service.client_id)

    if (!session) return Promise.resolve()

    let message: ChatBotMessage | false = false
    let mustSend: boolean = false
    let msg: ChatBotMessage

    switch (service.status) {
      case Service.STATUS_IN_PROGRESS:
        if (!service.metadata) {
          await session.setStatus(Session.STATUS_SERVICE_IN_PROGRESS)
          if (!session.notifications.assigned) {
            await session.setNotification(NotificationType.assigned)
            const snapshotVehicle = (snapshot.val() as any)?.vehicle as VehicleSnapshot | undefined
            let vehicleForMsg: VehicleSnapshot
            if (snapshotVehicle?.plate) {
              vehicleForMsg = snapshotVehicle
            } else if (service.driver_id) {
              const vehicle = await resolveDriverCurrentVehicle(service.driver_id)
              vehicleForMsg = { plate: vehicle?.plate ?? '', color: vehicle?.color ?? null }
            } else {
              vehicleForMsg = { plate: '', color: null }
            }
            msg = Messages.serviceAssigned(vehicleForMsg)
            message = msg
            mustSend = msg.enabled && !this.wpClient.wpNotifications
          }
        } else if ((service.metadata?.arrived_at ?? 0) > 0 && !service.metadata?.start_trip_at) {
          if (!session.notifications.arrived) {
            await session.setNotification(NotificationType.arrived)
            msg = Messages.getSingleMessage(MessagesEnum.DRIVER_ARRIVED)
            message = msg
            mustSend = msg.enabled && !this.wpClient.wpNotifications
          }
        }
        break
      case Service.STATUS_TERMINATED:
        await session.setStatus(Session.STATUS_COMPLETED)
        if (!session.notifications.completed) {
          await session.setNotification(NotificationType.completed)
          msg = Messages.completedService()
          message = msg
          mustSend = msg.enabled && !this.wpClient.wpNotifications
        }
        break
      case Service.STATUS_CANCELED:
        await session.setStatus(Session.STATUS_COMPLETED)
        if (!session.notifications.completed) {
          await session.setNotification(NotificationType.completed)
          msg = Messages.getSingleMessage(MessagesEnum.CANCELED)
          message = msg
          mustSend = msg.enabled && !this.wpClient.wpNotifications
        }
        break
      case Service.STATUS_PENDING:
        await session.setStatus(Session.STATUS_REQUESTING_SERVICE)
        break
      default:
        mustSend = false
        console.log('new service', service.id)
    }

    if (mustSend && message && !this.wpClient.wpNotifications)
      await this.sendMessage(service.client_id, message)
  }

  async sendMessage(chatId: string, message: ChatBotMessage): Promise<void> {
    const normalizedChatId = ChatIdHelper.normalize(chatId)
    const providerChatId = ChatIdHelper.toProviderChatId(normalizedChatId, this.client.serviceName)

    await this.client.sendMessage(providerChatId, message).catch((e) => {
      console.log(
        'sendMessage Error' + message.message.substring(0, 20),
        this.wpClient.alias,
        providerChatId,
        JSON.stringify(e)
      )
      Sentry.captureException(e)
      // if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WpStates.OPENING)
      if (this.client.serviceName === WpClients.WHATSAPP_WEB_JS) {
        return this.restartChromium()
      }
    })

    if (this.client.serviceName !== WpClients.OFFICIAL) {
      await MessageRepository.addMessage(
        this.wpClient.id,
        normalizedChatId,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          created_at: DateHelper.unix(),
          type: MessageTypes.TEXT,
          body: message.message,
          fromMe: true,
          location: undefined,
          interactive: message.interactive ?? null,
          interactiveReply: null,
        },
        {
          clientName:
            this.store.findClientById(normalizedChatId)?.name ?? `Chat ${normalizedChatId}`,
          processed: true,
        }
      )
    }

    if (this.client.serviceName != WpClients.OFFICIAL) {
      await this.client.getChatById(providerChatId).then(async (chat) => {
        setTimeout(async () => {
          await chat.archive().catch((e) => console.log(e.message))
        }, config.ARCHIVE_CHAT_TIMEOUT as number)
      })
    }
  }

  async restartChromium(): Promise<void> {
    const chromium = spawn(config.CHROMIUM_PATH, ['--remote-debugging-port=9222'], {
      stdio: 'ignore',
      detached: true,
    })
    chromium.unref()
    console.log('restart chromium...')
    return this.client.initialize()
  }
}
