export type DriverAvailabilityReason = 'negative_balance_percentage' | 'enabled_disabled' | null

export interface DriverAvailabilityInterface {
  canGoOnline: boolean
  canApply: boolean
  reason: DriverAvailabilityReason
  paymentMode: string
  balance: number
  enabledAt: number
}
