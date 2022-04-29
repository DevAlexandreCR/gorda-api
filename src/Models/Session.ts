import {SessionInterface} from '../Interfaces/SessionInterface'

export default class Session implements SessionInterface {
  public id: string
  public status: string
  public chat_id: string
  public service_id: string | null
  public created_at: number
  public updated_at: number | null
  
  static readonly STATUS_CREATED = 'CREATED'
  static readonly STATUS_ASKING_FOR_NEIGHBORHOOD = 'ASKING_FOR_NEIGHBORHOOD'
  static readonly STATUS_REQUESTING_SERVICE = 'REQUESTING_SERVICE'
  
  constructor(chat_id: string) {
    this.chat_id = chat_id
    this.created_at = new Date().getTime()
    this.status = Session.STATUS_CREATED
    this.service_id = null
  }
}