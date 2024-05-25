import { Client, LocalAuth } from 'whatsapp-web.js'
import { WpEvents } from '../constants/WpEvents'
import { WpStates } from '../constants/WpStates'
import { WPClientInterface } from '../interfaces/WPClientInterface'
import { WpChatInterface } from '../interfaces/WpChatInterface'
import config from '../../../../config'
import { WhatsAppClient } from '../WhatsAppClient'
import { WpClient } from '../../../Interfaces/WpClient'

export class WWebClient implements WPClientInterface {
    info: string
    private client: Client
    private wpClient: WpClient

    constructor(wpClient: WpClient) {
        this.wpClient = wpClient
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
                remotePath: remotePath
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
    }

    getWWebVersion(): Promise<string> {
        return this.client.getWWebVersion()
    }

    initialize(): Promise<void> {
        return this.client.initialize()
    }

    sendMessage(phoneNumber: string, message: string): boolean {
        throw new Error('Method not implemented.')
    }

    receiveMessage(phoneNumber: string): string {
        throw new Error('Method not implemented.')
    }

    on(event: WpEvents, callback: (...args: any) => void): void {
        this.client.on(event, callback)
    }

    getWWebVerison(): Promise<string> {
        throw new Error('Method not implemented.')
    }

    getState(): Promise<WpStates> {
        throw new Error('Method not implemented.')
    }

    getChatById(chatId: string): Promise<WpChatInterface> {
        throw new Error('Method not implemented.')
    }

    logout(): Promise<void> {
        throw new Error('Method not implemented.')
    }

    getCongig() {}
}
