import {Client, ClientSession, LocalAuth, WAState, Events, Message} from 'whatsapp-web.js'
import {Socket} from 'socket.io'
import ChatBot from '../chatBot/ChatBot'

export default class WhatsAppClient {
  
  public client: Client
  private socket: Socket
  static SESSION_PATH = 'storage/sessions'
  private chatBot: ChatBot
  
  constructor() {
    this.initClient()
  }
  
  initClient(): void {
    this.client = new Client({
      restartOnAuthFail: true,
      authStrategy: new LocalAuth({clientId: 'client', dataPath: 'storage/sessions'}),
      puppeteer: {args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]}
    })
  
    this.client.on(Events.MESSAGE_RECEIVED, this.onMessageReceived)
    this.client.on('qr', this.onQR)
    this.client.on(Events.READY, this.onReady)
    this.client.on(Events.AUTHENTICATED, this.onAuth)
    this.client.on(Events.AUTHENTICATION_FAILURE, this.onAuthFailure)
    this.client.on(Events.STATE_CHANGED, this.onStateChanged)
    this.client.on(Events.DISCONNECTED, this.onDisconnected)
  }
  
  setSocket(socket: Socket): void {
    this.socket = socket
    if(!this.chatBot) this.init().then(() => console.log('whatsapp is ready'))
  }
  
  onReady = (): void => {
    this.chatBot = new ChatBot(this.client)
    this.socket.emit(Events.READY)
  }
  
  onMessageReceived = (msg: Message): void => {
    this.chatBot.processMessage(msg).then(() => console.log('message processed: ', msg.id))
  }
  
  onQR = (qr: string): void => {
    this.socket.emit(Events.QR_RECEIVED, qr)
  }
  
  onAuth = (session: ClientSession): void => {
    console.log('authenticated ', session)
  }
  
  onDisconnected = async (reason: string | WAState): Promise<void> => {
    console.log('disconnected ', reason)
    this.socket.emit(Events.DISCONNECTED, reason)
    await this.client.destroy()
      .catch(e => {
        console.log('destroy ', e.message)
      })
  }
  
  onAuthFailure = (message: string): void => {
      this.socket.emit(Events.AUTHENTICATION_FAILURE, message)
      console.log(Events.AUTHENTICATION_FAILURE, message)
    }
  
  onStateChanged = (waState: WAState): void => {
    this.socket.emit(Events.STATE_CHANGED, waState)
    console.log('change_state ', waState)
  }
  
  init = (): Promise<void> => {
    console.log('init wp authentication')
    return this.client.initialize()
  }
  
  getState = (): void => {
    this.client.getState().then(state => {
      this.socket.emit('get-state', state)
    }).catch(e => {
      console.log('getState:: ', e.message)
      this.socket.emit('get-state', WAState.UNPAIRED)
    })
  }
  
  logout = (): void => {
    this.client.logout()
      .then(() => this.socket.emit('destroy'))
      .catch(e => console.log(e.message))
  }
}