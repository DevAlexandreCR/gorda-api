import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
import { WpLocation } from './WpLocation'
import { InteractiveReply } from '../Services/whatsapp/services/Official/Constants/InteractiveReply'
import { Interactive } from '../Services/whatsapp/services/Official/Constants/Interactive'

export type WpMessage = {
  created_at: number
  id: string
  type: MessageTypes
  msg: string
  processed: boolean
  location: WpLocation | null
  interactiveReply: InteractiveReply | null
  interactive: Interactive | null
}
