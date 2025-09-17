import { z } from 'zod'

export const SearchWithinPolygonRequest = z.object({
  query: z.object({
    lat: z.string()
      .transform(val => parseFloat(val))
      .pipe(z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90')),
    lng: z.string()
      .transform(val => parseFloat(val))
      .pipe(z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'))
  })
})

export type SearchWithinPolygonRequestType = z.infer<typeof SearchWithinPolygonRequest>
