import {SessionInterface} from '../Interfaces/SessionInterface'
import SessionRepository from '../Repositories/SessionRepository'

export default class Session implements SessionInterface {
  public id: string
  public status: string
  public chat_id: string
  public service_id: string | null
  public created_at: number
  public updated_at: number | null
  
  static readonly STATUS_CREATED = 'CREATED'
  static readonly STATUS_ASKING_FOR_PLACE = 'ASKING_FOR_PLACE'
  static readonly STATUS_CHOOSING_PLACE = 'CHOOSING_PLACE'
  static readonly STATUS_ASKING_FOR_COMMENT = 'ASKING_FOR_COMMENT'
  static readonly STATUS_REQUESTING_SERVICE = 'REQUESTING_SERVICE'
  static readonly STATUS_SERVICE_IN_PROGRESS = 'SERVICE_IN_PROGRESS'
  static readonly STATUS_COMPLETED = 'COMPLETED'
  static readonly STATUS_ASKING_FOR_NAME = 'ASKING_FOR_NAME'
  
  constructor(chat_id: string) {
    this.chat_id = chat_id
    this.created_at = new Date().getTime()
    this.status = Session.STATUS_CREATED
    this.service_id = null
  }
  
  isCompleted(): boolean {
    return this.status === Session.STATUS_COMPLETED
  }
  
  async setStatus(status: string): Promise<void> {
    this.status = status
    await SessionRepository.update(this)
  }
}