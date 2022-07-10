import {Client, LocalAuth, WAState, Events, Message} from 'whatsapp-web.js'
import {Socket} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'
import {DataSnapshot} from 'firebase-admin/lib/database'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Service from '../../Models/Service'
import {ServiceInterface} from '../../Interfaces/ServiceInterface'
import SessionRepository from '../../Repositories/SessionRepository'
import Session from '../../Models/Session'
import * as Messages from '../chatBot/Messages'
import {Store} from '../store/Store'

export default class WhatsAppClient {
  
  public client: Client
  private socket: Socket|null
  static SESSION_PATH = 'storage/sessions'
  private chatBot: ChatBot
  private store: Store = Store.getInstance()
  
  initClient(): void {
    this.client = new Client({
      restartOnAuthFail: true,
      authStrategy: new LocalAuth({dataPath: WhatsAppClient.SESSION_PATH}),
      puppeteer: {
        headless: true,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--unhandled-rejections=strict'
        ]}
    })
    
    this.client.on(Events.MESSAGE_RECEIVED, this.onMessageReceived)
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
    ServiceRepository.onServiceChanged(this.serviceChanged).catch(e => console.log(e.message))
    if (this.socket) this.socket.emit(Events.READY)
    console.table(this.client.pupBrowser?._targets)
  }
  
  onMessageReceived = (msg: Message): void => {
    this.chatBot.processMessage(msg).then(() => console.log('message processed: ', msg.id))
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
  
  serviceChanged = async (snapshot: DataSnapshot): Promise<void> => {
    const service = new Service()
    Object.assign(service, snapshot.val() as ServiceInterface)
    const session = new Session(service.client_id)
    let sessionDB = await SessionRepository.findSessionByChatId(service.client_id)
    if (!sessionDB) {
      sessionDB = await SessionRepository.create(session)
    }
    Object.assign(session, sessionDB)
    switch (service.status) {
      case Service.STATUS_IN_PROGRESS:
        const driver = this.store.findDriverById(service.driver_id!!)
        await session.setStatus(Session.STATUS_SERVICE_IN_PROGRESS)
        await this.chatBot.sendMessage(service.client_id, Messages.serviceAssigned(driver.vehicle.plate))
        break
      case Service.STATUS_TERMINATED:
        await session.setStatus(Session.STATUS_COMPLETED)
        await this.chatBot.sendMessage(service.client_id, Messages.SERVICE_COMPLETED)
        break
      case Service.STATUS_CANCELED:
        await session.setStatus(Session.STATUS_COMPLETED)
        await this.chatBot.sendMessage(service.client_id, Messages.CANCELED)
        break
      default:
        console.log('new service', service)
    }
  }
  
  logout = (): void => {
    this.client.logout()
      .then(() => {if (this.socket) this.socket.emit('destroy')})
      .catch(e => console.log(e.message))
  }
}