import {Location, MessageTypes} from 'whatsapp-web.js'

export type WpMessage = {
  id: string
  type: MessageTypes
  msg: string,
  processed: boolean
  location: Location
}