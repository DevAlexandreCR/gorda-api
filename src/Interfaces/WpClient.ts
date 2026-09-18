import { WpClients } from '../Services/whatsapp/constants/WPClients'

export type WpClient = {
  id: string
  alias: string
  wpNotifications: boolean
  full: boolean
  chatBot: boolean
  assistant: boolean
  agentInTrip: boolean
  service: WpClients
}
