import { VehicleInterface } from './VehicleInterface'
import { DriverAvailabilityInterface } from './DriverAvailabilityInterface'

export interface DriverInterface {
  id: string | null
  name: string
  email: string
  password?: string | null
  phone: string
  phone2?: string | null
  docType: string
  paymentMode?: string
  document: string
  photoUrl: string | null
  vehicle: VehicleInterface
  device?: Record<string, any> | null
  balance?: number
  enabled_at: number
  created_at: number
  last_connection?: number
  availability?: DriverAvailabilityInterface
}
