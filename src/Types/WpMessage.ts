import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
import { WpLocation } from './WpLocation'

export type WpMessage = {
  created_at: number
  id: string
  type: MessageTypes
  msg: string
  processed: boolean
  location: WpLocation | null
}
