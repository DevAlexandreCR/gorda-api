import { z } from 'zod'

export const DeletePlaceRequest = z.object({
  params: z.object({
    id: z.string().min(1, 'Place ID is required'),
  }),
})

export type DeletePlaceRequestType = z.infer<typeof DeletePlaceRequest>
