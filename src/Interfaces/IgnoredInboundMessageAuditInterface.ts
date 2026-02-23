export type IgnoredInboundMessageReason = 'old_message' | 'duplicate_message'

export interface IgnoredInboundMessageAuditInterface {
  id?: number
  wpClientId: string
  provider: string
  messageId: string
  chatId?: string | null
  rawTimestamp?: string | null
  messageType?: string | null
  reason: IgnoredInboundMessageReason
  messageAgeMinutes?: number | null
  messageTimestamp?: number | null
  receivedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}
