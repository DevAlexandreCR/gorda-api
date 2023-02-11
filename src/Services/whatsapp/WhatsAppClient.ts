import {Client, LocalAuth, WAState, Events, Message} from 'whatsapp-web.js'
import {Socket} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'
import config from '../../../config';
import {WpNotificationType} from '../../Interfaces/WpNotificationType'
import WpNotificationRepository from '../../Repositories/WpNotificationRepository'

export default class WhatsAppClient {
  
  public client: Client
  private socket: Socket | null
  static SESSION_PATH = 'storage/sessions'
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
  
  initClient(): void {
    this.client = new Client({
      authStrategy: new LocalAuth({dataPath: WhatsAppClient.SESSION_PATH}),
      puppeteer: {
        executablePath: config.CHROMIUM_PATH,
        headless: true,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--unhandled-rejections=strict'
        ]
      }
    })
    
    this.client.on('qr', this.onQR)
    this.client.on(Events.READY, this.onReady)
    this.client.on(Events.AUTHENTICATED, this.onAuth)
    this.client.on(Events.AUTHENTICATION_FAILURE, this.onAuthFailure)
    this.client.on(Events.STATE_CHANGED, this.onStateChanged)
    this.client.on(Events.DISCONNECTED, this.onDisconnected)
    
    this.init()
      .then(() => console.log('authenticated after init server'))
      .catch(e => console.log(e))
  }
  
  setSocket(socket: Socket): void {
    this.socket = socket
  }
  
  onReady = (): void => {
    this.chatBot = new ChatBot(this.client)
    WpNotificationRepository.onServiceAssigned(this.serviceAssigned).catch(e => console.log(e.message))
		WpNotificationRepository.onServiceTerminated(this.serviceTerminated).catch(e => console.log(e.message))
		WpNotificationRepository.onServiceCanceled(this.serviceCanceled).catch(e => console.log(e.message))
		WpNotificationRepository.onDriverArrived(this.driverArrived).catch(e => console.log(e.message))
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
  
  onDisconnected = async (reason: string | WAState): Promise<void> => {
    console.log('disconnected ', reason)
    if (this.socket) this.socket.emit(Events.DISCONNECTED, reason)
    await this.client.destroy()
      .catch(e => {
        console.log('destroy ', e.message)
      })
  }
  
  onAuthFailure = (message: string): void => {
    if (this.socket) this.socket.emit(Events.AUTHENTICATION_FAILURE, message)
    console.log(Events.AUTHENTICATION_FAILURE, message)
  }
  
  onStateChanged = (waState: WAState): void => {
    if (this.socket) this.socket.emit(Events.STATE_CHANGED, waState)
    console.log('change_state ', waState)
  }
  
  init = (): Promise<void> => {
    console.log('initializing whatsapp client...')
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
			})
    } else {
      console.error('can not send message cause driver id is not set')
    }
  }

  driverArrived = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.DRIVER_ARRIVED).then(() => {
			WpNotificationRepository.deleteNotification('arrived', snapshot.key?? '')
		})
  }

  serviceCanceled = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.CANCELED).then(() => {
			WpNotificationRepository.deleteNotification('canceled', snapshot.key?? '')
		})
  }

  serviceTerminated = async (snapshot: DataSnapshot): Promise<void> => {
    const notification: WpNotificationType = snapshot.val()
    this.client.sendMessage(notification.client_id, Messages.SERVICE_COMPLETED).then(() => {
			WpNotificationRepository.deleteNotification('terminated', snapshot.key?? '')
		})
  }
  
  logout = (): void => {
    this.client.logout()
      .then(() => {
        if (this.socket) this.socket.emit('destroy')
      })
      .catch(e => console.log(e.message))
  }
}