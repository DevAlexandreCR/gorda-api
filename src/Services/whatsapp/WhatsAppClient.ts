import {Client, Events, LocalAuth, Message, MessageTypes, WAState} from 'whatsapp-web.js'
import * as Sentry from '@sentry/node'
import {Server as SocketIOServer} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'
import config from '../../../config';
import {WpNotificationType} from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'
import {exit} from 'process'
import {EmitEvents} from './EmitEvents'
import {LoadingType} from '../../Interfaces/LoadingType'
import SettingsRepository from '../../Repositories/SettingsRepository'
import SessionRepository from '../../Repositories/SessionRepository'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import {ASK_FOR_CANCEL} from '../chatBot/Messages'

export default class WhatsAppClient {
  
  public client: Client
  private socket: SocketIOServer | null = null
  static SESSION_PATH = 'storage/sessions'
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
	initClient(): void {
    this.client = new Client({
      authStrategy: new LocalAuth({dataPath: WhatsAppClient.SESSION_PATH}),
			qrMaxRetries: 2,
			takeoverOnConflict: false,
      puppeteer: {
        executablePath: config.CHROMIUM_PATH,
        headless: true,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--unhandled-rejections=strict',
		  '--no-zygote'
        ]
      }
    })
    
    this.client.on(Events.QR_RECEIVED, this.onQR)
    this.client.on(Events.READY, this.onReady)
    this.client.on(Events.AUTHENTICATED, this.onAuth)
    this.client.on(Events.AUTHENTICATION_FAILURE, this.onAuthFailure)
    this.client.on(Events.STATE_CHANGED, this.onStateChanged)
    this.client.on(Events.DISCONNECTED, this.onDisconnected)
	this.client.on(Events.LOADING_SCREEN, this.onLoadingScreen)
	this.client.on(Events.MESSAGE_RECEIVED, this.onMessageReceived)

	this.init(false)
	  .then(async () => {
		  console.log('authenticated after init server')
		  await SettingsRepository.enableWpNotifications(true).catch(e => console.log(e.message))
	  })
	  .catch(e => {
			console.log(e.message)
		Sentry.captureException(e)
		exit(1)
	  })
  }
  
  setSocket(socket: SocketIOServer): void {
    this.socket = socket
  }
	
	thereIsSocket(): boolean {
		return this.socket !== null
	}
  
  onReady = (): void => {
    this.chatBot = new ChatBot(this.client)
	  WpNotificationRepository.onServiceAssigned(this.serviceAssigned).catch(e => Sentry.captureException(e))
	  WpNotificationRepository.onDriverArrived(this.driverArrived).catch(e => Sentry.captureException(e))
	  WpNotificationRepository.onNewService(this.onNewService).catch(e => Sentry.captureException(e))
    if (this.socket) this.socket.emit(Events.READY)
    console.table(this.client.pupBrowser?._targets)
  }

  onQR = (qr: string): void => {
    if (this.socket) this.socket.emit(Events.QR_RECEIVED, qr)
    console.log('sending qr code..', qr)
  }
  
  onAuth = (): void => {
		console.log('authentication successfully!')
  }
	
	onMessageReceived = (msg: Message): void => {
		if (this.isProcessableMsg(msg)) SessionRepository.addChat(msg).catch((e) => {
			console.log('msg message', msg.type, msg.from)
			console.warn('error saving message', e.message)
		})
	}

	isProcessableMsg(msg: Message): boolean {
		return (msg.type === MessageTypes.TEXT && !msg.from.includes('-'))
	}
  
  onDisconnected = async (reason: string | WAState): Promise<void> => {
    console.log('Client disconnected ', reason)
		await SettingsRepository.enableWpNotifications(false)
    if (this.socket) this.socket.emit(Events.DISCONNECTED, reason)
    if (reason === EmitEvents.NAVIGATION) await this.client.destroy().catch(e => {
			console.log('destroy ', e.message)
			this.socket?.emit(EmitEvents.FAILURE, e.message)
			Sentry.captureException(e)
			exit(1)
		})
  }
  
  onAuthFailure = (message: string): void => {
    if (this.socket) this.socket.emit(Events.AUTHENTICATION_FAILURE, message)
    console.log(Events.AUTHENTICATION_FAILURE, message)
  }
	
	onLoadingScreen = (percent: string, message: string): void => {
		const loading: LoadingType = {
			percent: percent,
			message: message
		}
		if (this.socket) this.socket.emit(Events.LOADING_SCREEN, loading)
		console.log(Events.LOADING_SCREEN, percent, message)
	}
	
  onStateChanged = (waState: WAState): void => {
    if (this.socket) this.socket.emit(EmitEvents.GET_STATE, waState)
    console.log(Events.STATE_CHANGED, waState)
  }
  
  init = async (web = true): Promise<void> => {
    console.log('initializing whatsapp client...')
		if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
		if (web && !this.client.pupPage?.isClosed()) await this.client.destroy().catch(e => console.log(e))
    return this.client.initialize()
  }
  
  getState = (): void => {
    this.client.getState().then(state => {
      if (this.socket) this.socket.emit(EmitEvents.GET_STATE, state)
    }).catch(e => {
      console.log(EmitEvents.GET_STATE, e.message)
      if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.UNPAIRED)
    })
  }
  
  serviceAssigned = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    if (notification.driver_id != null) {
      const driver = this.store.findDriverById(notification.driver_id)
      await this.client.sendMessage(notification.client_id, Messages.serviceAssigned(driver.vehicle)).then(() => {
				WpNotificationRepository.deleteNotification('assigned', snapshot.key?? '')
			}).catch(async e => {
				console.log('serviceAssigned', e)
				Sentry.captureException(e)
				if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
				exit(1)
			})
    } else {
      console.error('can not send message cause driver id is not set')
    }
  }

  driverArrived = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    await this.client.sendMessage(notification.client_id, Messages.DRIVER_ARRIVED).then(() => {
			WpNotificationRepository.deleteNotification('arrived', snapshot.key?? '')
		}).catch(async e => {
			console.log('driverArrived', e)
			Sentry.captureException(e)
			if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
			exit(1)
		})
  }

  serviceCanceled = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    await this.client.sendMessage(notification.client_id, Messages.CANCELED).then(() => {
			WpNotificationRepository.deleteNotification('canceled', snapshot.key?? '')
		}).catch(async e => {
			console.log('serviceCanceled', e)
			Sentry.captureException(e)
			await SettingsRepository.enableWpNotifications(false)
			if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
			exit(1)
		})
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    await this.client.sendMessage(notification.client_id, Messages.SERVICE_COMPLETED).then(() => {
			WpNotificationRepository.deleteNotification('terminated', snapshot.key?? '')
		}).catch(async e => {
			console.log('serviceTerminated', e)
			Sentry.captureException(e)
			await SettingsRepository.enableWpNotifications(false)
			if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
			exit(1)
		})
  }
	
	onNewService = async (snapshot: DataSnapshot): Promise<void> => {
		const notification: WpNotificationType = snapshot.val()
		this.cancelTimeout(snapshot.key!!, notification.client_id)
		await this.client.sendMessage(notification.client_id, Messages.NEW_SERVICE).then(() => {
			WpNotificationRepository.deleteNotification('new', snapshot.key?? '')
		}).catch(async e => {
			console.log('onNewService', e)
			Sentry.captureException(e)
			if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
			exit(1)
		})
	}
	
	cancelTimeout = (serviceId: string, clientId: string): void => {
		const timeout = config.CANCEL_TIMEOUT as number
		setTimeout(() => {
			ServiceRepository.findServiceStatusById(serviceId).then((status) => {
				if (status === Service.STATUS_PENDING) {
					this.client.sendMessage(clientId, ASK_FOR_CANCEL).catch(e => {
						console.log('cancelTimeout', e)
						Sentry.captureException(e)
						if (this.socket) this.socket.emit(EmitEvents.GET_STATE, WAState.OPENING)
						exit(1)
					})
				}
			})
		}, timeout)
	}
  
  logout = (): void => {
    this.client.logout()
      .then(() => {
        if (this.socket) this.socket.emit('destroy')
      })
      .catch(e => {
			console.log('logout: ', e)
			if (this.socket) this.socket.emit(EmitEvents.FAILURE, e.message)
			Sentry.captureException(e)
			exit(1)
		})
  }
}