import { Message } from '../../../../Interfaces/Message'
import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponseInterface {
  name?: string
  message: Message
  session_status: SessionStatuses
}
