import { WpClients } from '../Services/whatsapp/constants/WPClients'

export type WpClient = {
  id: string
  alias: string
  wpNotifications: boolean
  chatBot: boolean
  assistant: boolean
  service: WpClients
}
