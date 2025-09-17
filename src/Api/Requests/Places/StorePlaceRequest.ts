import { z } from 'zod'

export const StorePlaceRequest = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').trim(),
    lat: z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
    lng: z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
    cityId: z.string().min(1, 'City ID is required')
  })
})

export type StorePlaceRequestType = z.infer<typeof StorePlaceRequest>
