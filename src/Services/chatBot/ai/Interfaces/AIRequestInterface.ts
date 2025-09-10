import { Message } from '../../../../Interfaces/Message'
import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponseInterface {
  message: Message
  session_status: SessionStatuses
}
