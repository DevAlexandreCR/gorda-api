import { Message } from '../../../../Interfaces/Message'
import { LocType } from '../../../../Interfaces/LocType'
import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponseInterface {
  messages: Message[]
  session_status: SessionStatuses
  data: {
    location?: LocType
  }
}