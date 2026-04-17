export type DriverUpdates = {
  [driverId: string]: {
    observedAt: number
    lastSeenAt: number | null
  }
}
