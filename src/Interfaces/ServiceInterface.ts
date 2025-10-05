import Place from '../Models/Place'
import { Metadata } from './Metadata'
import { PlaceInterface } from './PlaceInterface'

export interface ServiceInterface {
  id: string | null
  status: string
  start_loc: PlaceInterface
  end_loc: PlaceInterface
  phone: string
  name: string
  comment: string | null
  amount: number | null
  metadata: Metadata
  driver_id: string | null
  client_id: string
  created_at: number
}
