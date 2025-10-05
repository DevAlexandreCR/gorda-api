import { DataMessagePayload } from 'firebase-admin/messaging'

export type FCMNotification = {
  title: string
  body: string
  data?: DataMessagePayload
}
