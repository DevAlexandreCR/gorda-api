import Place from '../Models/Place'
import { Metadata } from './Metadata'
import { PlaceInterface } from './PlaceInterface'

export interface ServiceInterface {
  id: string | null
  status: string
  start_loc: PlaceInterface
  end_loc: PlaceInterface | null
  phone: string
  name: string
  comment: string | null
  amount: number | null
  metadata: Metadata
  driver_id: string | null
  client_id: string
  wp_client_id?: string | null
  created_at: number
  created_by?: string | null
  assigned_by?: string | null
  canceled_by?: string | null
  terminated_by?: string | null
  // RTDB-only snapshot fields (not persisted directly to service_history columns)
  client_completed_services_count?: number | null
  vehicle?: { plate: string; brand?: string | null; model?: string | null; color?: any } | null
  // Persisted FK — set from vehicle snapshot on finalize
  vehicle_id?: string | null
  // Persisted column — copied from metadata.discount on finalize; not an RTDB snapshot field
  deducted_value?: number
}
