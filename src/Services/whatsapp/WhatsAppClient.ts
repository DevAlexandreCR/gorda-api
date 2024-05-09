import {Client, Events, LocalAuth, Message, MessageTypes, WAState} from 'whatsapp-web.js'
import * as Sentry from '@sentry/node'
import {Server as SocketIOServer} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'
import config from '../../../config'
import {WpNotificationType} from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'
import {exit} from 'process'
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

export class WhatsAppClient {
  
  public client: Client
  private socket: SocketIOServer | null = null
  static SESSION_PATH = 'storage/sessions/'
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
	private wpClient: WpClient
	public deleting = false
	public starting = false

	constructor(client: WpClient) {
		this.wpClient = client
	}

	initClient(): void {
		const remotePath = `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${config.WWEB_VERSION}.html`
    this.client = new Client({
      authStrategy: new LocalAuth({
				clientId: this.wpClient.id,
				dataPath: WhatsAppClient.SESSION_PATH
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
			this.client.getWWebVersion()
			.then(version => console.log('wweb version', version))
			.catch(e => console.log('Error getting the version', e.message))
		  console.log('authenticated after init server', this.wpClient.alias)
			this.starting = false
	  })
	  .catch(e => {
			this.starting = false
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
    this.chatBot = new ChatBot(this.client, this.wpClient.id)
		this.chatBot.sync()
	  WpNotificationRepository.onServiceAssigned(this.wpClient.id, this.serviceAssigned)
	  WpNotificationRepository.onDriverArrived(this.wpClient.id, this.driverArrived)
	  WpNotificationRepository.onNewService(this.wpClient.id, this.onNewService)
		WpNotificationRepository.onServiceCanceled(this.wpClient.id, this.serviceCanceled)
		WpNotificationRepository.onServiceTerminated(this.wpClient.id, this.serviceTerminated)
		ServiceRepository.onServiceChanged(this.serviceChanged)
    if (this.socket) this.socket.to(this.wpClient.id).emit(Events.READY)
    console.table(this.client.pupBrowser?._targets)
  }

  onQR = (qr: string): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(Events.QR_RECEIVED, qr)
    console.log('sending qr code..', this.wpClient.alias, qr)
  }
  
  onAuth = (): void => {
		console.log('authentication successfully!', this.wpClient.alias)
  }
	
	onMessageReceived = async (msg: Message): Promise<void> => {
		if (this.isProcessableMsg(msg)) await this.chatBot.processMessage(msg).catch(e => console.log(e.message))
	}

	isProcessableMsg(msg: Message): boolean {
		const session = this.chatBot.findSessionByChatId(msg.from)
		if (session) return true
		if (this.wpClient.assistant) return (msg.type === MessageTypes.LOCATION)
		if (this.wpClient.chatBot) {
			return msg.type === MessageTypes.LOCATION ||
				(msg.type === MessageTypes.TEXT && !msg.isStatus && !msg.from.includes('-'))
		}

		return false
	}

  onDisconnected = async (reason: string | WAState): Promise<void> => {
    console.log('Client disconnected ', this.wpClient.alias, reason)
		await SettingsRepository.enableWpNotifications(this.wpClient.id, false)
    if (this.socket) this.socket.to(this.wpClient.id).emit(Events.DISCONNECTED, reason)
    if (reason === EmitEvents.NAVIGATION) await this.client.destroy().catch(e => {
			console.log('destroy ', this.wpClient.alias, e.message)
			this.socket?.emit(EmitEvents.FAILURE, e.message)
			Sentry.captureException(e)
			exit(1)
		})
  }
  
  onAuthFailure = (message: string): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(Events.AUTHENTICATION_FAILURE, message)
    console.log(Events.AUTHENTICATION_FAILURE, this.wpClient.alias, message)
  }
	
	onLoadingScreen = (percent: string, message: string): void => {
		const loading: LoadingType = {
			percent: percent,
			message: message
		}
		if (this.socket) this.socket.to(this.wpClient.id).emit(Events.LOADING_SCREEN, loading)
		console.log(Events.LOADING_SCREEN, this.wpClient.alias, percent, message)
	}
	
  onStateChanged = (waState: WAState): void => {
    if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, waState)
    console.log(Events.STATE_CHANGED, this.wpClient.alias, waState)
  }
  
  init = async (web = true): Promise<void> => {
		this.starting = true
    console.log('initializing whatsapp client...', this.wpClient.alias)
		if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WAState.OPENING)
		if (web && !this.client.pupPage?.isClosed()) await this.client.destroy().catch(e => console.log(e, this.wpClient.alias))
    return this.client.initialize()
  }
  
  getState = (): void => {
    this.client.getState().then(state => {
      if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, state)
    }).catch(e => {
      console.log(EmitEvents.GET_STATE, this.wpClient.alias, e.message)
      if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WAState.UNPAIRED)
    })
  }
  
  serviceAssigned = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    if (notification.driver_id != null && notification.wp_client_id == this.wpClient.id) {
      const driver = this.store.findDriverById(notification.driver_id)
			const msg = Messages.serviceAssigned(driver.vehicle)
			if (msg.enabled) {
				await this.sendMessage(notification.client_id, msg.message).then(() => {
					WpNotificationRepository.deleteNotification('assigned', snapshot.key?? '')
				})
			} else {
				await WpNotificationRepository.deleteNotification('assigned', snapshot.key?? '')
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
				WpNotificationRepository.deleteNotification('arrived', snapshot.key?? '')
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
				WpNotificationRepository.deleteNotification('canceled', snapshot.key?? '')
			})
		} else {
			await WpNotificationRepository.deleteNotification('canceled', snapshot.key ?? '')
		}
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
		const msg = Messages.getSingleMessage(MessagesEnum.SERVICE_COMPLETED)
		if (msg.enabled) {
			await this.sendMessage(notification.client_id, msg.message).then(() => {
				WpNotificationRepository.deleteNotification('terminated', snapshot.key?? '')
			})
		} else {
			await WpNotificationRepository.deleteNotification('terminated', snapshot.key ?? '')
		}
  }
	
	onNewService = async (snapshot: DataSnapshot): Promise<void> => {
		setTimeout(async () => {
			const notification: WpNotificationType = snapshot.val()
			this.cancelTimeout(snapshot.key!!, notification.client_id)
			const msg = Messages.getSingleMessage(MessagesEnum.SERVICE_CREATED)
			if (msg.enabled) {
				await this.sendMessage(notification.client_id, msg.message).then(() => {
					WpNotificationRepository.deleteNotification('new', snapshot.key?? '')
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
  
  logout = (): void => {
    this.client.destroy()
      .then(() => {
        if (this.socket) this.socket.to(this.wpClient.id).emit('destroy')
      })
      .catch(e => {
			console.log('logout: ', this.wpClient.alias, e)
			if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.FAILURE, e.message)
			Sentry.captureException(e)
			exit(1)
		})
  }

	setWpClient(client: WpClient): void {
		this.wpClient.wpNotifications = client.wpNotifications
		this.wpClient.chatBot = client.chatBot
		this.wpClient.assistant = client.assistant
	}

	serviceChanged = async (snapshot: DataSnapshot): Promise<void> => {
		if (!this.wpClient.chatBot && !this.wpClient.assistant) return
		const service = new Service()
		Object.assign(service, snapshot.val() as ServiceInterface)

		let session = this.chatBot.findSessionByChatId(service.client_id)

		if (!session) return

		let message: string|false = false
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
					}
				} else if (service.metadata.arrived_at > 0 && !service.metadata.start_trip_at) {
					if (!session.notifications.arrived) {
						await session.setNotification(NotificationType.arrived)
						msg = Messages.getSingleMessage(MessagesEnum.DRIVER_ARRIVED)
						message = msg.message
					}
				}
				if (!this.wpClient.wpNotifications && message) mustSend = true
				break
			case Service.STATUS_TERMINATED:
				await session.setStatus(Session.STATUS_COMPLETED)
				msg = Messages.getSingleMessage(MessagesEnum.SERVICE_COMPLETED)
				message = msg.message
				mustSend = msg.enabled
				break
			case Service.STATUS_CANCELED:
				await session.setStatus(Session.STATUS_COMPLETED)
				msg = Messages.getSingleMessage(MessagesEnum.CANCELED)
				message = msg.message
				mustSend = msg.enabled
				break
			case Service.STATUS_PENDING:
				await session.setStatus(Session.STATUS_REQUESTING_SERVICE)
				break
			default:
				mustSend = false
				console.log('new service', service.id)
		}

		if (mustSend && message) await this.sendMessage(service.client_id, message)
	}

	async sendMessage(chatId: string, message: string): Promise<void> {
		await this.client.getChatById(chatId).then(async chat =>{
			await chat.sendMessage(message).catch(e => {
				console.log('sendMessage ' + message, this.wpClient.alias, e)
				Sentry.captureException(e)
				if (this.socket) this.socket.to(this.wpClient.id).emit(EmitEvents.GET_STATE, WAState.OPENING)
				exit(1)
			}).then(async msg => {
				setTimeout(async () => {
					await chat.archive().catch(e => console.log(e.message))
				}, config.ARCHIVE_CHAT_TIMEOUT as number)
			})
		})
	}
}