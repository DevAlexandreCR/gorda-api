import { Message } from '../../../../Interfaces/Message'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { Intent } from '../../../../Types/Intent'

export interface AIResponseInterface {
  intent: Intent
  name?: string
  message: Message
  sessionStatus: SessionStatuses
  place?: string
}
