import { MessageHandlerInterface } from './Interfaces/MessageHandlerInterface'

class MessageHandler {
  constructor(private client: MessageHandlerInterface) {}

  async handleMessage(message: string) {
    return this.client.handleMessage(message)
  }
}
