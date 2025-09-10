import { City } from './City'

export type Branch = {
  id: string
  calling_code: string
  country: string
  currency_code: string
  cities: Map<string, City>
}
