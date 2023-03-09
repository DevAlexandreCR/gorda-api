import {Client, Events, LocalAuth, WAState} from 'whatsapp-web.js'
import * as Sentry from '@sentry/node'
import {Server as SocketIOServer} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'
import config from '../../../config';
import {WpNotificationType} from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'
import DateHelper from '../../Helpers/DateHelper'
import {exit} from 'process'

export default class WhatsAppClient {
  
  public client: Client
  private socket: SocketIOServer | null = null
  static SESSION_PATH = 'storage/sessions'
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
	
	private intervalKeepAlive: NodeJS.Timeout
  
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
    
    this.client.on('qr', this.onQR)
    this.client.on(Events.READY, this.onReady)
    this.client.on(Events.AUTHENTICATED, this.onAuth)
    this.client.on(Events.AUTHENTICATION_FAILURE, this.onAuthFailure)
    this.client.on(Events.STATE_CHANGED, this.onStateChanged)
    this.client.on(Events.DISCONNECTED, this.onDisconnected)
    
    this.init(false)
      .then(() => console.log('authenticated after init server'))
      .catch(e => {
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
		this.intervalKeepAlive = setInterval(this.keepSessionAlive, 300000)
		this.client.pupPage?.on('close', async () => {
			console.log('Page Closed', DateHelper.dateString())
		})
  }

  onQR = (qr: string): void => {
    if (this.socket) this.socket.emit(Events.QR_RECEIVED, qr)
    console.log('sending qr code..', qr)
  }
  
  onAuth = (): void => {
		const dateString = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
		console.log('authentication successfully!', dateString)
  }
  
  onDisconnected = async (reason: string | WAState): Promise<void> => {
		clearInterval(this.intervalKeepAlive?.ref())
    console.log('Client disconnected '  + DateHelper.dateString(), reason)
    if (this.socket) this.socket.emit(Events.DISCONNECTED, reason)
    if (reason === 'NAVIGATION') await this.client.destroy().catch(e => {
			console.log('destroy ', e.message)
			Sentry.captureException(e)
			exit(1)
		})
  }
  
  onAuthFailure = (message: string): void => {
    if (this.socket) this.socket.emit(Events.AUTHENTICATION_FAILURE, message)
    console.log(Events.AUTHENTICATION_FAILURE, message)
  }
  
  onStateChanged = (waState: WAState): void => {
    if (this.socket) this.socket.emit(Events.STATE_CHANGED, waState)
		if (waState == WAState.CONNECTED) this.intervalKeepAlive = setInterval(this.keepSessionAlive, 300000)
		else clearInterval(this.intervalKeepAlive?.ref())
    console.log('change_state ', waState, DateHelper.dateString())
  }
  
  init = async (web = true): Promise<void> => {
    console.log('initializing whatsapp client...', DateHelper.dateString())
		if (web && !this.client.pupPage?.isClosed()) await this.client.destroy().catch(e => console.log(e))
    return this.client.initialize()
  }
  
  getState = (): void => {
    this.client.getState().then(state => {
      if (this.socket) this.socket.emit('get-state', state)
    }).catch(e => {
      console.log('getState:: ', e.message)
      if (this.socket) this.socket.emit('get-state', WAState.UNPAIRED)
    })
  }
  
  serviceAssigned = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    if (notification.driver_id != null) {
      const driver = this.store.findDriverById(notification.driver_id)
      this.client.sendMessage(notification.client_id, Messages.serviceAssigned(driver.vehicle)).then(() => {
				WpNotificationRepository.deleteNotification('assigned', snapshot.key?? '')
			}).catch(e => {
				console.log('serviceAssigned', e)
				Sentry.captureException(e)
				exit(1)
			})
    } else {
      console.error('can not send message cause driver id is not set')
    }
  }

  driverArrived = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.DRIVER_ARRIVED).then(() => {
			WpNotificationRepository.deleteNotification('arrived', snapshot.key?? '')
		}).catch(e => {
			console.log('driverArrived', e)
			Sentry.captureException(e)
			exit(1)
		})
  }

  serviceCanceled = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.CANCELED).then(() => {
			WpNotificationRepository.deleteNotification('canceled', snapshot.key?? '')
		}).catch(e => {
			console.log('serviceCanceled', e)
			Sentry.captureException(e)
			exit(1)
		})
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.SERVICE_COMPLETED).then(() => {
			WpNotificationRepository.deleteNotification('terminated', snapshot.key?? '')
		}).catch(e => {
			console.log('serviceTerminated', e)
			Sentry.captureException(e)
			exit(1)
		})
  }
	
	onNewService = async (snapshot: DataSnapshot): Promise<void> => {
		const notification: WpNotificationType = snapshot.val()
		this.client.sendMessage(notification.client_id, Messages.NEW_SERVICE).then(() => {
			WpNotificationRepository.deleteNotification('new', snapshot.key?? '')
		}).catch(e => {
			console.log('onNewService', e)
			Sentry.captureException(e)
			exit(1)
		})
	}
  
  logout = (): void => {
    this.client.logout()
      .then(() => {
        if (this.socket) this.socket.emit('destroy')
      })
      .catch(e => {
				console.log('logout: ', e)
				Sentry.captureException(e)
				exit(1)
			})
  }
	
	keepSessionAlive = (): void => {
		if (!this.client.pupPage?.isClosed()) this.client.sendMessage('573103794656@c.us', Messages.PING).catch(e => {
			console.log('Ping!', e)
			Sentry.captureException(e)
			exit(1)
		})
	}
}