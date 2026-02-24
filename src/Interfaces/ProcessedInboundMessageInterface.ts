export interface ProcessedInboundMessageInterface {
  id?: number
  wpClientId: string
  messageId: string
  provider: string
  processedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}
