import { Message } from 'whatsapp-web.js'
import { MessageTypes } from '../../../constants/MessageTypes'
import { MessageTypes as Type } from 'whatsapp-web.js'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WpChatAdapter } from './WpChatAdapter'
import { LocType } from '../../../../../Interfaces/LocType'

export class WpMessageAdapter implements WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType

  constructor(private message: Message) {
    this.id = message.id.id
    this.timestamp = message.timestamp
    this.type = this.getType(message.type)
    this.from = message.from
    this.isStatus = message.isStatus
    this.body = message.body
    this.location = message.location as unknown as LocType
  }

  private getType(type: Type): MessageTypes {
    switch (type) {
      case Type.TEXT:
        return MessageTypes.TEXT
        break
      case Type.LOCATION:
        return MessageTypes.LOCATION
      default:
        return MessageTypes.UNKNOWN
        break
    }
  }

  async getChat(): Promise<WpChatInterface> {
    const chat = await this.message.getChat()

    return new WpChatAdapter(chat)
  }
}
