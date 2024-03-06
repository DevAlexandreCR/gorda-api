import {ServiceInterface} from '../Interfaces/ServiceInterface'
import dayjs from 'dayjs'
import ServiceRepository from '../Repositories/ServiceRepository'
import {PlaceInterface} from '../Interfaces/PlaceInterface'
import {Metadata} from '../Interfaces/Metadata'

export default class Service implements ServiceInterface {
  id: string
  status: string
  phone: string
  name: string
  end_loc: PlaceInterface
  start_loc: PlaceInterface
  amount: number | null
  driver_id: string | null
  wp_client_id: string
  client_id: string
  created_at: number
  comment: string | null
  metadata: Metadata

  static readonly STATUS_PENDING = 'pending'
  static readonly STATUS_IN_PROGRESS = 'in_progress'
  static readonly STATUS_TERMINATED = 'terminated'
  static readonly STATUS_CANCELED = 'canceled'
  static readonly EVENT_CANCEL = 'cancel-service'
  static readonly EVENT_TERMINATE = 'end-service'
  static readonly EVENT_ASSIGN = 'assign-service'
  static readonly EVENT_RELEASE = 'release-service'

  constructor() {
    this.created_at = dayjs().unix()
    this.status = Service.STATUS_PENDING
  }

  isPending(): boolean {
    return this.status === Service.STATUS_PENDING
  }

  isinProgress(): boolean {
    return this.status === Service.STATUS_IN_PROGRESS
  }
  
  async cancel(): Promise<void> {
    this.status = Service.STATUS_CANCELED
    await ServiceRepository.update(this)
  }
}