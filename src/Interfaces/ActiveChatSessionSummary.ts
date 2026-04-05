import { PlaceOption } from './PlaceOption'
import { PlaceInterface } from './PlaceInterface'
import { WpNotifications } from '../Types/WpNotifications'

export interface ActiveChatSessionSummary {
  sessionId: string
  status: string
  service_id: string | null
  notifications: WpNotifications
  place: PlaceInterface | null
  placeOptions?: Array<PlaceOption>
}
