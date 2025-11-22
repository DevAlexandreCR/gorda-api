import { z } from 'zod'

export const IndexClientsRequest = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .optional(),
  }),
})

export type IndexClientsRequestType = z.infer<typeof IndexClientsRequest>
