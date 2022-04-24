import {SessionInterface} from '../Interfaces/SessionInterface'

export default class Session implements SessionInterface {
  public id: string
  public status: string
  public chat_id: string
  public service_id: string | null
  public created_at: number
  public updated_at: number | null
  
  constructor(chat_id: string) {
    this.chat_id = chat_id
    this.created_at = new Date().getTime()
    this.status = 'pending'
    this.service_id = null
  }
}