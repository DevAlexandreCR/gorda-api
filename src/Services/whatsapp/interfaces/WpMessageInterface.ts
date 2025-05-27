import { LocType } from '../../../Interfaces/LocType'
import { MessageTypes } from '../constants/MessageTypes'
import { InteractiveReply } from '../services/Official/Constants/InteractiveReply'
import { WpChatInterface } from './WpChatInterface'

export interface WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType
  interactiveReply: InteractiveReply | null

  getChat(): Promise<WpChatInterface>
}
