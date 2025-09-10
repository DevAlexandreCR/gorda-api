import { AIResponseInterface } from './AIResponseInterface'

export interface MessageHandlerInterface {
  handleMessage(message: string): Promise<AIResponseInterface>
}
