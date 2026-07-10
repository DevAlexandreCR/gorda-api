export interface PlaceInterface {
  id: string
  name: string
  lat: number
  lng: number
  location: any
  cityId: string
  city?: string
  country?: string
  createdAt?: Date
  updatedAt?: Date
}
