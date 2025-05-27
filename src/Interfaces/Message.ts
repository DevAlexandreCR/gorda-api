import { Interactive } from '../Services/whatsapp/services/Official/Constants/Interactive'
import { LocType } from '../Interfaces/LocType'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'
import { InteractiveReply } from '../Services/whatsapp/services/Official/Constants/InteractiveReply'

export type Message = {
  id: string
  created_at: number
  type: MessageTypes
  body: string
  fromMe: boolean
  location?: LocType
  interactive: Interactive | null
  interactiveReply: InteractiveReply | null
}
