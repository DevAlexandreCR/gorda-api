import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponse {
  name?: string
  message: string
  session_status: SessionStatuses
  place?: string
}
