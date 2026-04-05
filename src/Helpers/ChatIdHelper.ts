import { WpClients } from '../Services/whatsapp/constants/WPClients'

class ChatIdHelper {
  normalize(chatId: string): string {
    return chatId.replace(/@(c\.us|s\.whatsapp\.net)$/i, '').trim()
  }

  toProviderChatId(chatId: string, serviceName: WpClients): string {
    const normalizedChatId = this.normalize(chatId)

    if (serviceName === WpClients.OFFICIAL) {
      return normalizedChatId
    }

    return normalizedChatId.includes('@') ? normalizedChatId : `${normalizedChatId}@c.us`
  }
}

export default new ChatIdHelper()
