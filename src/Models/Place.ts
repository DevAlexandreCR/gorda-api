import { PlaceInterface } from '../Interfaces/PlaceInterface'

export default class Place implements PlaceInterface {
  name: string
  lat: number
  lng: number
  key: string
  country: string
  city: string
}
