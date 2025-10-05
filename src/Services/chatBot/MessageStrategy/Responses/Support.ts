import { ResponseContract } from '../ResponseContract'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

export class Support extends ResponseContract {
  public messageSupported: Array<string> = [
    MessageTypes.TEXT,
    MessageTypes.LOCATION,
    MessageTypes.INTERACTIVE,
    MessageTypes.AUDIO,
    MessageTypes.IMAGE,
    MessageTypes.VIDEO,
    MessageTypes.DOCUMENT,
  ]

  public async processMessage(message: WpMessage): Promise<void> {
    // In SUPPORT status, the chatbot does not respond automatically
    // The operator will handle the conversation manually
    // This method intentionally does nothing to prevent automatic responses
    return Promise.resolve()
  }
}
