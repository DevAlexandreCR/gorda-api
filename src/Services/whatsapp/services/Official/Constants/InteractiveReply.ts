export type InteractiveReply = {
  type?: 'button_reply' | 'list_reply' | 'product_reply'
  button_reply?: {
    id: string
    title: string
  }
  list_reply?: {
    id: string
    title: string
    description?: string
  }
}
