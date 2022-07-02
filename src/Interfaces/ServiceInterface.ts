import {LocType} from './LocType'

export interface ServiceInterface {
  id: string | null
  status: string
  start_loc: LocType
  end_loc: LocType
  phone: string
  name: string
  comment: string | null
  amount: number | null
  driver_id: string | null
  client_id: string
  created_at: number
}