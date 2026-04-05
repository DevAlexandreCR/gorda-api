import { PlaceOption } from './PlaceOption'
import { PlaceInterface } from './PlaceInterface'
import { WpNotifications } from '../Types/WpNotifications'

export interface ChatSessionRecordInterface {
  id: string
  wpClientId: string
  chatId: string
  status: string
  service_id: string | null
  place: PlaceInterface | null
  placeOptions?: Array<PlaceOption>
  notifications: WpNotifications
  assigned_at: number
  created_at: number
  updated_at: number | null
}
