import {PlaceOption} from './PlaceOption'
import Place from '../Models/Place'
import {WpMessageMap} from '../Types/WpMessageMap'
import {WpMessage} from '../Types/WpMessage'
import {Chat} from 'whatsapp-web.js'
import {WpNotifications} from '../Types/WpNotifications'

export interface SessionInterface {
  id: string
  status: string
  placeOptions?: Array<PlaceOption>
  place: Place | null
  chat: Chat
  wp_client_id: string
  chat_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
  notifications: WpNotifications
  messages?: Map<string, WpMessage>
}