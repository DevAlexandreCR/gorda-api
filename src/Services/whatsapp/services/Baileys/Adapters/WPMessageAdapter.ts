import { LocType } from '../../../../../Interfaces/LocType'
import { MessageTypes } from '../../../constants/MessageTypes'
import { WpChatInterface } from '../../../interfaces/WpChatInterface'
import { WpMessageInterface } from '../../../interfaces/WpMessageInterface'
import { WAMessage, WASocket, WAProto, toNumber } from '@whiskeysockets/baileys'
import { WpChatAdapter } from './WpChatAdapter'
import { InteractiveReply } from '../../Official/Constants/InteractiveReply'

type InteractiveKind = 'button_reply' | 'list_reply'

export class WpMessageAdapter implements WpMessageInterface {
  id: string
  timestamp: number
  type: MessageTypes
  from: string
  isStatus: boolean
  body: string
  location: LocType
  interactiveReply: InteractiveReply | null = null

  constructor(
    private message: WAMessage,
    private waSocket: WASocket,
    from: string
  ) {
    this.id = message.key.id!
    this.timestamp = toNumber(message.messageTimestamp)
    this.isStatus = message.broadcast ?? false
    // Resolved by BaileysClient's messages.upsert handler per design D5 (PN, PN alt,
    // or the LID-to-PN mapping) before this adapter is constructed.
    this.from = from
    this.type = MessageTypes.UNKNOWN
    this.body = ''

    this.classify(this.unwrap(message.message))
  }

  // Disappearing messages and view-once media wrap the real content one level
  // deep; unwrap recursively so a wrapper around another wrapper still resolves.
  private unwrap(content?: WAProto.IMessage | null): WAProto.IMessage | undefined {
    if (!content) {
      return undefined
    }
    const wrapped =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message
    return wrapped ? this.unwrap(wrapped) : content
  }

  private classify(content?: WAProto.IMessage): void {
    if (!content) {
      return
    }

    const text = content.conversation || content.extendedTextMessage?.text
    if (text) {
      this.type = MessageTypes.TEXT
      this.body = text
      return
    }

    if (content.locationMessage) {
      this.type = MessageTypes.LOCATION
      this.location = {
        lat: content.locationMessage.degreesLatitude as number,
        lng: content.locationMessage.degreesLongitude as number,
        name: content.locationMessage.name as string,
      }
      return
    }

    if (content.buttonsResponseMessage?.selectedButtonId) {
      this.setInteractive('button_reply', content.buttonsResponseMessage.selectedButtonId)
      return
    }

    if (content.listResponseMessage?.singleSelectReply?.selectedRowId) {
      this.setInteractive('list_reply', content.listResponseMessage.singleSelectReply.selectedRowId)
      return
    }

    if (content.templateButtonReplyMessage?.selectedId) {
      this.setInteractive('button_reply', content.templateButtonReplyMessage.selectedId)
      return
    }

    const nativeFlowId = this.readNativeFlowResponseId(content)
    if (nativeFlowId) {
      this.setInteractive('button_reply', nativeFlowId)
    }
  }

  // The native flow response carries its selected id inside a JSON string
  // (`paramsJson`), not a plain field.
  private readNativeFlowResponseId(content: WAProto.IMessage): string | undefined {
    const paramsJson = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    if (!paramsJson) {
      return undefined
    }
    try {
      const params = JSON.parse(paramsJson)
      return typeof params?.id === 'string' ? params.id : undefined
    } catch {
      return undefined
    }
  }

  private setInteractive(kind: InteractiveKind, id: string): void {
    this.type = MessageTypes.INTERACTIVE
    this.body = id
    this.interactiveReply =
      kind === 'button_reply'
        ? { type: 'button_reply', button_reply: { id, title: '' } }
        : { type: 'list_reply', list_reply: { id, title: '' } }
  }

  getChat(): Promise<WpChatInterface> {
    return Promise.resolve(new WpChatAdapter(this.waSocket, this.from))
  }
}
