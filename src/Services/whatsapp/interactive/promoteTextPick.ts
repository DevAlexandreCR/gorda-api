import MessageRepository from '../../../Repositories/MessageRepository'
import { MessageTypes } from '../constants/MessageTypes'
import { InteractiveReply } from '../services/Official/Constants/InteractiveReply'
import { resolveInteractiveOption } from './resolveInteractiveOption'

export interface TextPickMessage {
  type: MessageTypes
  body: string
  interactiveReply: InteractiveReply | null
}

// Design D3/D4 (spec: chatbot-candidate-list - "Plain-text picks are promoted on every
// transport"): a plain-text pick of the most recently offered catalog option is promoted
// to INTERACTIVE before the message reaches the chatbot or gets persisted, matching a
// native button/list reply. Only a TEXT message is a candidate; an already-INTERACTIVE
// message (a native reply forwarded through an adapter) passes through unchanged. Shared
// by every transport: Baileys lines call it from WhatsAppClient, Official lines call it
// from MessageController.
export async function promoteTextPick(
  wpClientId: string,
  chatId: string,
  msg: TextPickMessage
): Promise<void> {
  if (msg.type !== MessageTypes.TEXT) return

  const latestOutbound = await MessageRepository.findLatestOutbound(wpClientId, chatId)
  const matched = resolveInteractiveOption(msg.body, latestOutbound?.interactive ?? null)
  if (!matched) return

  msg.type = MessageTypes.INTERACTIVE
  msg.interactiveReply = matched
  msg.body = matched.button_reply?.id ?? matched.list_reply?.id ?? msg.body
}
