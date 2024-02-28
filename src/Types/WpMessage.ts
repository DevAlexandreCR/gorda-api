import {Location, MessageTypes} from 'whatsapp-web.js'

export type WpMessage = {
  created_at: number
  id: string
  type: MessageTypes
  msg: string,
  processed: boolean
  location: Location
}