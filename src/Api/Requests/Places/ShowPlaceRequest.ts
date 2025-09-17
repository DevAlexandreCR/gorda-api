import { z } from 'zod'

export const ShowPlaceRequest = z.object({
  params: z.object({
    id: z.string().min(1, 'Place ID is required')
  })
})

export type ShowPlaceRequestType = z.infer<typeof ShowPlaceRequest>
