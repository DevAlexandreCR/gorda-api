import { DriverInterface } from '../../Interfaces/DriverInterface'
import {
  DriverAvailabilityInterface,
  DriverAvailabilityReason,
} from '../../Interfaces/DriverAvailabilityInterface'

const MONTHLY_PAYMENT_MODE = 'monthly'
const PERCENTAGE_PAYMENT_MODE = 'percentage'

export function resolveDriverAvailabilityReason(
  driver: Pick<DriverInterface, 'paymentMode' | 'balance' | 'enabled_at'>
): DriverAvailabilityReason {
  const paymentMode = driver.paymentMode ?? MONTHLY_PAYMENT_MODE
  const balance = Number(driver.balance ?? 0)
  const enabledAt = Number(driver.enabled_at ?? 0)

  if (paymentMode === PERCENTAGE_PAYMENT_MODE && balance <= 0) {
    return 'negative_balance_percentage'
  }

  if (enabledAt <= 0) {
    return 'enabled_disabled'
  }

  return null
}

export function buildDriverAvailability(
  driver: Pick<DriverInterface, 'paymentMode' | 'balance' | 'enabled_at'>
): DriverAvailabilityInterface {
  const paymentMode = driver.paymentMode ?? MONTHLY_PAYMENT_MODE
  const balance = Number(driver.balance ?? 0)
  const enabledAt = Number(driver.enabled_at ?? 0)
  const reason = resolveDriverAvailabilityReason(driver)
  const isEligible = reason === null

  return {
    canGoOnline: isEligible,
    canApply: isEligible,
    reason,
    paymentMode,
    balance,
    enabledAt,
  }
}
