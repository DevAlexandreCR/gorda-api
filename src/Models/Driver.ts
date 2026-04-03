import { DriverInterface } from '../Interfaces/DriverInterface'
import Vehicle from './Vehicle'
import { VehicleInterface } from '../Interfaces/VehicleInterface'
import dayjs from 'dayjs'

export default class Driver implements DriverInterface {
  id: string | null
  created_at: number
  last_connection = 0
  docType: string
  document: string
  email: string
  password: string | null
  enabled_at = 0
  name: string
  phone: string
  phone2: string | null
  paymentMode = 'monthly'
  photoUrl: string | null
  vehicle: VehicleInterface
  device: Record<string, any> | null
  balance = 0

  constructor() {
    this.id = null
    this.created_at = dayjs().unix()
    this.photoUrl = null
    this.password = null
    this.phone2 = null
    this.vehicle = new Vehicle()
    this.device = null
  }

  isEnabled(): boolean {
    return !!this.enabled_at
  }
}
