import {PlaceOption} from './PlaceOption'
import Place from '../Models/Place'
import {WpMessageMap} from '../Types/WpMessageMap'

export interface SessionInterface {
  id: string
  status: string
  placeOptions?: Array<PlaceOption>
  place: Place | null
  chat_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
  messages: WpMessageMap
}