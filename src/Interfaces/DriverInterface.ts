import { VehicleInterface } from './VehicleInterface'
import { DriverAvailabilityInterface } from './DriverAvailabilityInterface'
import { VehicleRecordInterface } from './VehicleRecordInterface'

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
  selected_vehicle_id?: string | null
  selected_vehicle?: VehicleRecordInterface | null
  active_vehicle_id?: string | null
  availability?: DriverAvailabilityInterface
}
