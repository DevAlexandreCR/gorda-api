import Place from '../Models/Place'

export interface ServiceInterface {
  id: string | null
  status: string
  start_loc: Place
  end_loc: Place
  phone: string
  name: string
  comment: string | null
  amount: number | null
  driver_id: string | null
  client_id: string
  created_at: number
}