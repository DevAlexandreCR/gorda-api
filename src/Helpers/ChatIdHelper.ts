import { WpClients } from '../Services/whatsapp/constants/WPClients'

class ChatIdHelper {
  normalize(chatId: string): string {
    return chatId.replace(/@(c\.us|s\.whatsapp\.net)$/i, '').trim()
  }

  toCanonicalClientId(value: string): string {
    if (value == null) {
      throw new Error(`toCanonicalClientId: value must not be null or undefined`)
    }

    const trimmed = value.trim()
    const suffixStripped = trimmed.replace(/@(c\.us|s\.whatsapp\.net)$/i, '')
    const plusStripped = suffixStripped.replace(/^\+/, '')

    if (!/^\d+$/.test(plusStripped)) {
      throw new Error(
        `toCanonicalClientId: "${value}" did not resolve to a digits-only string (got "${plusStripped}")`
      )
    }

    return plusStripped
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
