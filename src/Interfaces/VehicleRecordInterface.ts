export interface VehicleRecordInterface {
  id: string
  plate: string
  brand: string | null
  model: string | null
  color: { name: string; hex?: string } | null
  photo_url: string | null
  soat_exp: Date | null
  tec_exp: Date | null
  enabled: boolean
  created_at: Date
  updated_at: Date
}
