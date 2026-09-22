import { Interactive } from '../Services/whatsapp/services/Official/Constants/Interactive'

export type ChatBotMessage = {
  id: string
  name: string
  description: string
  message: string
  enabled: boolean
  interactive: Interactive | null
  // Set by TurnSupport.sendGatedMessage so the transport's own persistence
  // (Official OfficialClient.text) and recordOutboundMessage converge on one
  // whatsapp_messages row instead of each writing its own.
  outboundId?: string
}
