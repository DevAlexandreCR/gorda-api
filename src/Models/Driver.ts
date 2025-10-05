import { DriverInterface } from '../Interfaces/DriverInterface'
import Vehicle from './Vehicle'
import { VehicleInterface } from '../Interfaces/VehicleInterface'
import dayjs from 'dayjs'

export default class Driver implements DriverInterface {
  id: string | null
  created_at: number
  docType: string
  document: string
  email: string
  enabled_at = 0
  name: string
  phone: string
  photoUrl: string | null
  vehicle: VehicleInterface

  constructor() {
    this.id = null
    this.created_at = dayjs().unix()
    this.photoUrl = null
    this.vehicle = new Vehicle()
  }

  isEnabled(): boolean {
    return !!this.enabled_at
  }
}
