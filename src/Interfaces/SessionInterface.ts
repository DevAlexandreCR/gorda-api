export interface SessionInterface {
  id: string
  status: string
  last_message_id?: string
  chat_id: string
  service_id: string | null
  created_at: number
  updated_at: number | null
}