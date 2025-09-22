export type Interactive = {
  type: 'list' | 'button' | 'product' | 'flow' | 'location_request_message'
  body?: {
    text: string
  }
  action: {
    name?: string
    button?: string
    sections?: Array<{
      title?: string
      rows: Array<{
        id: string
        title: string
        description?: string
      }>
    }>
    buttons?: Array<{
      type: 'reply'
      reply?: {
        id: string
        title: string
      }
    }>
  }
  header?: {
    type: 'text' | 'image' | 'video' | 'document'
    text: string
  }
  footer?: {
    text: string
  }
}
