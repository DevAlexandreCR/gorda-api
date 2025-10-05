export interface VehicleInterface {
  brand: string
  model: string
  photoUrl: string | null
  plate: string
  color: { name: string; hex: string }
}
