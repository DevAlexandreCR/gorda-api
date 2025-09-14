import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponse {
  name?: string
  message: string
  sessionStatus: SessionStatuses
  place?: string
}
