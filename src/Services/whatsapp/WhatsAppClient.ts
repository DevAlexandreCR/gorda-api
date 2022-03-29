import {Client, ClientSession, LegacySessionAuth, WAState, Events} from 'whatsapp-web.js'
import {Socket} from 'socket.io'
import * as fs from 'fs'
import qrcode from 'qrcode-terminal' //TODO remove, it is only for tests

export default class WhatsAppClient {
  
  public client: Client
  private socket: Socket
  private sessionData: ClientSession
  static SESSION_PATH = 'storage/sessions/session.json'
  
  constructor() {
    console.log('init client wp')
    this.initClient()
  }
  
  initClient(): void {
    this.client = new Client({
      authStrategy: new LegacySessionAuth({session: this.getSessionData()}),
      puppeteer: {args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]}
    })
  
    this.client.on(Events.MESSAGE_RECEIVED, (msg) => {
      console.log(msg.body)
    })
    this.client.on('qr', this.onQR)
    this.client.on(Events.READY, this.onReady)
    this.client.on(Events.AUTHENTICATED, this.onAuth)
    this.client.on(Events.AUTHENTICATION_FAILURE, (message) => {
      this.socket.emit(Events.AUTHENTICATION_FAILURE, message)
      console.log(Events.AUTHENTICATION_FAILURE, message)
    })
    this.client.on(Events.STATE_CHANGED, (message) => {
      this.socket.emit(Events.STATE_CHANGED, message)
      console.log('change_state ', message)
    })
    this.client.on(Events.DISCONNECTED, async (message) => {
      console.log('disconnected ', message)
      if (message !== WAState.CONFLICT) fs.unlinkSync(WhatsAppClient.SESSION_PATH)
      this.socket.emit(Events.DISCONNECTED, message)
      await this.client.destroy()
        .catch(e => {
          console.log('destroy ', e.message)
        })
    })
  }
  
  setSocket(socket: Socket): void {
    this.socket = socket
  }
  
  getSessionData = (): ClientSession => {
    if(fs.existsSync(WhatsAppClient.SESSION_PATH)) {
      this.sessionData = require('../../../' + WhatsAppClient.SESSION_PATH);
    }
    
    return this.sessionData
  }
  
  onReady = (): void => {
    console.log('ready')
    this.socket.emit(Events.READY)
  }
  
  onQR = (qr: string): void => {
    console.log(qr)
    qrcode.generate(qr, {small: true}); //TODO remove, it is only for tests
    this.socket.emit(Events.QR_RECEIVED, qr)
  }
  
  onAuth = (session: ClientSession): void => {
    console.log('authenticated')
    fs.writeFile(WhatsAppClient.SESSION_PATH, JSON.stringify(session), (err) => {
      if (err) {
        console.error(err);
      }
    })
  }
  
  init = (): Promise<void> => {
    console.log('init wp authentication')
    return this.client.initialize()
  }
  
  reset(): void {
    this.client.resetState().then(() => {
      this.socket.emit('reset', this.client.info)
    }).catch(e=> {
      console.log(e.message)
    })
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
    this.client.logout().then(() => {
      this.socket.emit('destroy')
    })
  }
}