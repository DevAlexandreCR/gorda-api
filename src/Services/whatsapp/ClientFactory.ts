import { WpClient } from '../../Interfaces/WpClient'
import { WpClients } from './constants/WPClients'
import { WPClientInterface } from './interfaces/WPClientInterface'
import { BaileysClient } from './services/Baileys/BaileysClient'
import { OfficialClient } from './services/Official/OfficialClient'

export class ClientFactory {
  static build(wpClient: WpClient): WPClientInterface {
    switch (wpClient.service) {
      case WpClients.OFFICIAL:
        return OfficialClient.getInstance(wpClient)
      case WpClients.BAILEYS:
        return new BaileysClient(wpClient)
      default:
        throw new Error(`Unsupported WhatsApp transport: ${wpClient.service}`)
    }
  }
}
