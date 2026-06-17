import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export const BOGOTA_TIMEZONE = 'America/Bogota'

export function currentPeriod(): string {
  return dayjs().tz(BOGOTA_TIMEZONE).format('YYYY-MM')
}

export function currentDayOfMonth(): number {
  return dayjs().tz(BOGOTA_TIMEZONE).date()
}
