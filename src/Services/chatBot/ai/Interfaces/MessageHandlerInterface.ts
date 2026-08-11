import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { AIResponseInterface } from './AIResponseInterface'
import { AIRequestContext } from './AIRequestContext'

export interface MessageHandlerInterface {
  handleMessage(
    message: string,
    sessionStatus: SessionStatuses,
    context: AIRequestContext
  ): Promise<AIResponseInterface>
}
