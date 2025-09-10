import { MessageHandlerInterface } from './Interfaces/MessageHandlerInterface'

export class MessageHandler {
  constructor(private client: MessageHandlerInterface) { }

  async handleMessage(message: string) {
    return this.client.handleMessage(message)
  }
}
