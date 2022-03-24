import {Client, ClientSession, LegacySessionAuth} from 'whatsapp-web.js'
import {Socket} from "socket.io";
import * as fs from "fs";
import qrcode from 'qrcode-terminal' //TODO remove, it is only for tests

export default class WhatsAppClient {
  
  public client: Client
  private readonly socket: Socket
  private sessionData: ClientSession
  static SESSION_PATH = 'storage/sessions/session.json'
  
  constructor(socket: Socket) {
    this.socket = socket

    this.client = new Client({
      authStrategy: new LegacySessionAuth({session: this.getSessionData()}),
      puppeteer: {args: ['--use-gl=egl']}
    })
  }
  
  getSessionData(): ClientSession {
    if(fs.existsSync(WhatsAppClient.SESSION_PATH)) {
      this.sessionData = require('../../../' + WhatsAppClient.SESSION_PATH);
    }
    
    return this.sessionData
  }
  
  onReady(): void {
    console.log('Client is ready!');
  }
  
  onQR(qr: string): void {
    qrcode.generate(qr, {small: true}); //TODO remove, it is only for tests
    this.socket.emit('qr-code', qr)
  }
  
  onAuth(session: ClientSession): void {
    fs.writeFile(WhatsAppClient.SESSION_PATH, JSON.stringify(session), (err) => {
      if (err) {
        console.error(err);
      }
    })
  }
  
  init(): Promise<void> {
    this.client.on('qr', this.onQR)
    this.client.on('ready', this.onReady)
    this.client.on('authenticated', this.onAuth)
    return this.client.initialize()
  }
}