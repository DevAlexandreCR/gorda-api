import { WpClient } from '../../Interfaces/WpClient'
import { WpClients } from './constants/WPClients'
import { WPClientInterface } from './interfaces/WPClientInterface'
import { BaileysClient } from './services/Baileys/BaileysClient'
import { OfficialClient } from './services/Official/OfficialClient'
import { WWebClient } from './services/WWebClient/WWebClient'

export class ClientFactory {
  static build(wpClient: WpClient): WPClientInterface {
    switch (wpClient.service) {
      case WpClients.WHATSAPP_WEB_JS:
        return new WWebClient(wpClient)
      case WpClients.OFFICIAL:
        return OfficialClient.getInstance(wpClient)
      case WpClients.BAILEYS:
        return new BaileysClient(wpClient)
      default:
        throw new Error('Client not found')
    }
  }
}
