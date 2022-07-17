import {PlaceOption} from './PlaceOption'

export interface SessionInterface {
  id: string
  status: string
  placeOptions?: Array<PlaceOption>
  chat_id: string
  place_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
}