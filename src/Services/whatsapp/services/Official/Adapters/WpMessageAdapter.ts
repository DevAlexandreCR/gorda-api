import { MessageTypes } from '../../../constants/MessageTypes'
import { LocType } from '../../../../../Interfaces/LocType'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpChatAdapter } from './WpChatAdapter'
import { OfficialClient } from '../OfficialClient'

export class WpMessageAdapter implements WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType

  constructor(
    message: {
      id: string
      timestamp: number
      type: MessageTypes
      from: string
      isStatus: boolean
      body: string
      location?: LocType
    },
    private client: OfficialClient,
  ) {
    this.id = message.id
    this.timestamp = message.timestamp
    this.type = message.type
    this.from = message.from
    this.isStatus = message.isStatus
    this.body = message.body
    if (message.location) {
      this.location = message.location
    }
  }

  async getChat(): Promise<WpChatInterface> {
    return new WpChatAdapter(this.client, this.from)
  }
}
