import { Interactive } from '../Services/whatsapp/services/Official/Constants/Interactive'
import { InteractiveReply } from '../Services/whatsapp/services/Official/Constants/InteractiveReply'
import { LocType } from './LocType'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'

export interface WhatsappMessageRecordInterface {
  id?: number
  wpClientId: string
  chatId: string
  chatSessionId?: string | null
  messageId: string
  created_at: number
  type: MessageTypes
  body: string
  fromMe: boolean
  processed: boolean
  location?: LocType | null
  interactive?: Interactive | null
  interactiveReply?: InteractiveReply | null
}
