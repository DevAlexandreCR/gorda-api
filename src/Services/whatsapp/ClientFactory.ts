import { WpClients } from './constants/WPClients'
import { WPClientInterface } from './interfaces/WPClientInterface'
import { OfficialClient } from './services/OfficialClient'
import { WWebClient } from './services/WWebClient'

export class ClientFactory {
    static readonly WHATSAPP_WEB_JS = 'whatsapp-web-js'
    static readonly OFFICIAL = 'api-oficial'

    static build(wp: WpClients ): WPClientInterface {

        let client = this.getClient(wp)
        return client.build()
    }

    static getClient(client: WpClients): WPClientInterface {
        switch (client) {
            case WpClients.WHATSAPP_WEB_JS:
                return new WWebClient()
            case WpClients.OFFICIAL:
                return new OfficialClient()
            default:
                throw new Error('Client not found')
        }
    }
}