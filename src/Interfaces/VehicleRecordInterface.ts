export interface VehicleRecordInterface {
  id: string
  plate: string
  brand: string | null
  model: string | null
  color: { name: string; hex?: string } | null
  photoUrl: string | null
  soat_exp: Date | null
  tec_exp: Date | null
  enabled: boolean
  created_at: Date
  updated_at: Date
  linked_drivers_count?: number
}
