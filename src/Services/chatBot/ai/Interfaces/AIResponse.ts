import { SessionStatuses } from '../../../../Types/SessionStatuses'

export interface AIResponse {
  name?: string
  outputText: string
  sessionStatus: SessionStatuses
  place?: string
}
