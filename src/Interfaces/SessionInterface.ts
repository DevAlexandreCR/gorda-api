import {PlaceOption} from './PlaceOption'
import Place from '../Models/Place'
import {WpMessageMap} from '../Types/WpMessageMap'
import {WpMessage} from '../Types/WpMessage'

export interface SessionInterface {
  id: string
  status: string
  placeOptions?: Array<PlaceOption>
  place: Place | null
  chat_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
  messages?: Map<string, WpMessage>
}