import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { Intent } from '../../../../Types/Intent'

export interface AIResponse {
  intent: Intent
  name?: string
  message: string
  session_status: SessionStatuses
  place?: string
}
