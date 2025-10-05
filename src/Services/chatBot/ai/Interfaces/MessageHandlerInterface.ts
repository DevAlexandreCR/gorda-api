import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { AIResponseInterface } from './AIResponseInterface'

export interface MessageHandlerInterface {
  handleMessage(message: string, sessionStatus: SessionStatuses): Promise<AIResponseInterface>
}
