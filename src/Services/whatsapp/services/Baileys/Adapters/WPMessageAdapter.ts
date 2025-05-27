import { LocType } from '../../../../../Interfaces/LocType'
import { MessageTypes } from '../../../constants/MessageTypes'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WAMessage, WASocket, WAProto } from '@whiskeysockets/baileys'
import { WpChatAdapter } from './WpChatAdapter'
import { InteractiveReply } from '../../Official/Constants/InteractiveReply'

export class WpMessageAdapter implements WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType
  interactiveReply = null

  constructor(private message: WAMessage, private waSocket: WASocket) {
    this.id = message.key.id!
    this.timestamp = message.messageTimestamp as number
    this.type = message.message?.conversation ? MessageTypes.TEXT : MessageTypes.UNKNOWN
    this.isStatus = message.broadcast?? false
    this.body = message.message?.conversation || ''
    this.from = message.key.remoteJid!.replace('@s.whatsapp.net', '@c.us')
    if (message.message?.locationMessage) {
      this.type = MessageTypes.LOCATION
      this.location = {
        lat: message.message.locationMessage.degreesLatitude as number,
        lng: message.message.locationMessage.degreesLongitude as number,
        name: message.message.locationMessage.name as string,
      }
    }
  }

  getChat(): Promise<WpChatInterface> {
    return Promise.resolve(new WpChatAdapter(this.waSocket, this.from))
  }
}
