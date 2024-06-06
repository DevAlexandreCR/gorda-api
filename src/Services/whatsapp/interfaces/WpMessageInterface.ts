import { LocType } from '../../../Interfaces/LocType'
import { MessageTypes } from '../constants/MessageTypes'
import { WpChatInterface } from './WpChatInterface'

export interface WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType

  getChat(): Promise<WpChatInterface>
}
