export type TypingIndicatorMessage = {
  messaging_product: string
  status: 'read'
  message_id: string
  typing_indicator: {
    type: 'text'
  }
}
