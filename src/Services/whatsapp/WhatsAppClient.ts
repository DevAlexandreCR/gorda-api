import * as Sentry from '@sentry/node'
import {Server as SocketIOServer} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'
import config from '../../../config'
import {WpNotificationType} from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'
import {EmitEvents} from './EmitEvents'
import {LoadingType} from '../../Interfaces/LoadingType'
import SettingsRepository from '../../Repositories/SettingsRepository'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import {WpClient} from '../../Interfaces/WpClient'
import Session from '../../Models/Session'
import {ServiceInterface} from '../../Interfaces/ServiceInterface'
import {NotificationType} from '../../Types/NotificationType'
import {MessagesEnum} from '../chatBot/MessagesEnum'
import {ChatBotMessage} from '../../Types/ChatBotMessage'
import {WpStates} from './constants/WpStates'
import {WpEvents} from './constants/WpEvents'
import {WPClientInterface} from './interfaces/WPClientInterface'
import {WpMessageInterface} from './interfaces/WpMessageInterface'
import {ClientFactory} from './ClientFactory'
import {WpClients} from './constants/WPClients'
import {MessageTypes} from './constants/MessageTypes'
import {spawn} from 'child_process'

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
    console.log('message received', this.wpClient.alias, msg.type, msg.from, msg.body.substring(0, 50))
    if (this.isProcessableMsg(msg)) await this.chatBot.processMessage(msg).catch((e) => console.log(e.message))
  }

  isProcessableMsg(msg: WpMessageInterface): boolean {
    const session = this.chatBot.findSessionByChatId(msg.from)
    if (session && (msg.type === MessageTypes.LOCATION || msg.type === MessageTypes.TEXT)) return true
    if (this.wpClient.assistant) return msg.type === MessageTypes.LOCATION
    if (this.wpClient.chatBot) {
      return (
        msg.type === MessageTypes.LOCATION ||
        (msg.type === MessageTypes.TEXT && !msg.isStatus && !msg.from.includes('-'))
      )
    }

    return false
  }

  onDisconnected = async (reason: string | WpStates): Promise<void> => {
    console.log('Client disconnected ', this.wpClient.alias, reason)
    if (!this.deleting) {
      await SettingsRepository.enableWpNotifications(this.wpClient.id, false)
    }
    if (this.socket) this.socket.to(this.wpClient.id).emit(WpEvents.DISCONNECTED, reason)
    if (reason === EmitEvents.NAVIGATION)
      await this.client.logout().catch((e) => {
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
        if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WpStates.UNPAIRED)
      })
  }

  serviceAssigned = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    if (notification.driver_id != null && notification.wp_client_id == this.wpClient.id) {
      const driver = this.store.findDriverById(notification.driver_id)
      const msg = Messages.serviceAssigned(driver.vehicle)
      if (msg.enabled) {
        await this.sendMessage(notification.client_id, msg.message).then(() => {
          WpNotificationRepository.deleteNotification('assigned', snapshot.key ?? '')
        })
      } else {
        await WpNotificationRepository.deleteNotification('assigned', snapshot.key ?? '')
      }
    } else {
      console.error('can not send message cause driver id is not set')
    }
  }

  driverArrived = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    const msg = Messages.getSingleMessage(MessagesEnum.DRIVER_ARRIVED)
    if (msg.enabled) {
      await this.sendMessage(notification.client_id, msg.message).then(() => {
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
      await this.sendMessage(notification.client_id, msg.message).then(() => {
        WpNotificationRepository.deleteNotification(Service.STATUS_CANCELED, snapshot.key ?? '')
      })
    } else {
      await WpNotificationRepository.deleteNotification(Service.STATUS_CANCELED, snapshot.key ?? '')
    }
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    const msg = Messages.getSingleMessage(MessagesEnum.SERVICE_COMPLETED)
    if (msg.enabled) {
      await this.sendMessage(notification.client_id, msg.message).then(() => {
        WpNotificationRepository.deleteNotification(Service.STATUS_TERMINATED, snapshot.key ?? '')
      })
    } else {
      await WpNotificationRepository.deleteNotification(Service.STATUS_TERMINATED, snapshot.key ?? '')
    }
  }

  onNewService = async (snapshot: DataSnapshot): Promise<void> => {
    setTimeout(async () => {
      const notification: WpNotificationType = snapshot.val()
      this.cancelTimeout(snapshot.key!!, notification.client_id)
      const msg = Messages.getSingleMessage(MessagesEnum.SERVICE_CREATED)
      if (msg.enabled) {
        await this.sendMessage(notification.client_id, msg.message).then(() => {
          WpNotificationRepository.deleteNotification('new', snapshot.key ?? '')
        })
      } else {
        await WpNotificationRepository.deleteNotification('new', snapshot.key ?? '')
      }
    }, 2000)
  }

  cancelTimeout = (serviceId: string, clientId: string): void => {
    setTimeout(async () => {
      await ServiceRepository.findServiceStatusById(serviceId).then(async (status) => {
        if (status === Service.STATUS_PENDING) {
          const msg = Messages.getSingleMessage(MessagesEnum.ASK_FOR_CANCEL)
          if (msg.enabled) {
            await this.sendMessage(clientId, msg.message)
          }
        }
      })
    }, config.CANCEL_TIMEOUT as number)
  }

  logout = async (): Promise<void> => {
    await this.client
      .logout()
      .then(async () => {
        console.log('logout successfully', this.wpClient.alias)
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
  }

  serviceChanged = async (snapshot: DataSnapshot): Promise<void> => {
    if (!this.wpClient.chatBot && !this.wpClient.assistant) return Promise.resolve()
    const service = new Service()
    Object.assign(service, snapshot.val() as ServiceInterface)

    let session = this.chatBot.findSessionByChatId(service.client_id)

    if (!session) return Promise.resolve()

    let message: string | false = false
    let mustSend: boolean = false
    let msg: ChatBotMessage

    switch (service.status) {
      case Service.STATUS_IN_PROGRESS:
        const driver = this.store.findDriverById(service.driver_id!!)
        if (!service.metadata) {
          await session.setStatus(Session.STATUS_SERVICE_IN_PROGRESS)
          if (!session.notifications.assigned) {
            await session.setNotification(NotificationType.assigned)
            msg = Messages.serviceAssigned(driver.vehicle)
            message = msg.message
            mustSend = msg.enabled && !this.wpClient.wpNotifications
          }
        } else if (service.metadata.arrived_at > 0 && !service.metadata.start_trip_at) {
          if (!session.notifications.arrived) {
            await session.setNotification(NotificationType.arrived)
            msg = Messages.getSingleMessage(MessagesEnum.DRIVER_ARRIVED)
            message = msg.message
            mustSend = msg.enabled && !this.wpClient.wpNotifications
          }
        }
        break
      case Service.STATUS_TERMINATED:
        await session.setStatus(Session.STATUS_COMPLETED)
        if (!session.notifications.completed) {
          await session.setNotification(NotificationType.completed)
          msg = Messages.getSingleMessage(MessagesEnum.SERVICE_COMPLETED)
          message = msg.message
          mustSend = msg.enabled && !this.wpClient.wpNotifications
        }
        break
      case Service.STATUS_CANCELED:
        await session.setStatus(Session.STATUS_COMPLETED)
        if (!session.notifications.completed) {
          await session.setNotification(NotificationType.completed)
          msg = Messages.getSingleMessage(MessagesEnum.CANCELED)
          message = msg.message
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

    if (mustSend && message && !this.wpClient.wpNotifications) await this.sendMessage(service.client_id, message)
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    await this.client.sendMessage(chatId, message).catch((e) => {
      console.warn('sendMessage Error' + message, this.wpClient.alias, e.message, chatId)
      Sentry.captureException(e)
      // if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WpStates.OPENING)
      if (this.client.serviceName === WpClients.WHATSAPP_WEB_JS) {
        return this.restartChromium()
      }
    })

    if (this.client.serviceName != WpClients.OFFICIAL) {
      await this.client.getChatById(chatId).then(async (chat) => {
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
    return  this.client.initialize()
  }
}
