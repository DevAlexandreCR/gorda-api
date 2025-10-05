import { PlaceOption } from './PlaceOption'
import Place from '../Models/Place'
import { WpMessage } from '../Types/WpMessage'
import { WpNotifications } from '../Types/WpNotifications'
import { WpChatInterface } from '../Services/whatsapp/interfaces/WpChatInterface'
import { PlaceInterface } from './PlaceInterface'

export interface SessionInterface {
  id: string
  status: string
  placeOptions?: Array<PlaceOption>
  place: PlaceInterface | null
  chat: WpChatInterface
  wp_client_id: string
  chat_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
  notifications: WpNotifications
  messages?: Map<string, WpMessage>
}
