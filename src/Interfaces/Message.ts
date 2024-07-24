import { LocType } from '../Interfaces/LocType'
import { MessageTypes } from '../Services/whatsapp/constants/MessageTypes'

export type Message = {
  id: string
  created_at: number
  type: MessageTypes
  body: string
  fromMe: boolean
  location?: LocType
}
