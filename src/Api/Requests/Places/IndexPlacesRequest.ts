import { z } from 'zod'

export const IndexPlacesRequest = z.object({
  query: z.object({
    cityId: z.string().min(1, 'City ID is required'),
  }),
})

export type IndexPlacesRequestType = z.infer<typeof IndexPlacesRequest>
