import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export const BOGOTA_TIMEZONE = 'America/Bogota'

export const PERIOD_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/

export function currentPeriod(): string {
  return dayjs().tz(BOGOTA_TIMEZONE).format('YYYY-MM')
}

export function currentDayOfMonth(): number {
  return dayjs().tz(BOGOTA_TIMEZONE).date()
}

export function periodEnd(period: string): number {
  return dayjs.tz(period, BOGOTA_TIMEZONE).endOf('month').unix()
}
