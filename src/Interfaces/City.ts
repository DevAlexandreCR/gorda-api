import { LatLng } from "./LatLng"

export type City = {
    id: string
    name: string
    percentage: number
    location: {
        lat: number
        lng: number
    },
    polygon: Array<LatLng>
}