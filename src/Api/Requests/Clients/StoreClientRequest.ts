import { z } from 'zod'

export const StoreClientRequest = z.object({
  body: z.object({
    id: z
      .string()
      .trim()
      .min(5, 'Client ID must have at least 5 characters')
      .regex(/@c\.us$/, 'Client ID must end with @c.us')
      .optional(),
    name: z
      .string()
      .min(1, 'Name is required')
      .trim(),
    phone: z
      .string()
      .min(6, 'Phone is required')
      .regex(/^\+?\d+$/, 'Phone must contain only numbers')
      .trim(),
    photoUrl: z
      .string()
      .url('Photo URL must be a valid URL')
      .optional(),
  }),
})

export type StoreClientRequestType = z.infer<typeof StoreClientRequest>
