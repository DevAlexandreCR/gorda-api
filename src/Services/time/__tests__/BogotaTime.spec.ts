import { currentPeriod, currentDayOfMonth } from '../BogotaTime'

describe('BogotaTime', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns the current period as YYYY-MM', () => {
    const period = currentPeriod()
    expect(period).toMatch(/^\d{4}-\d{2}$/)
  })

  it('returns the current day of month as a number between 1 and 31', () => {
    const day = currentDayOfMonth()
    expect(typeof day).toBe('number')
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(31)
  })

  it('computes the period using Bogota time, not UTC, near a month boundary', () => {
    // 2026-03-01T03:30:00Z is 2026-02-28 22:30 in America/Bogota (UTC-5)
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T03:30:00Z'))

    expect(currentPeriod()).toBe('2026-02')
    expect(currentDayOfMonth()).toBe(28)
  })

  it('computes the period using Bogota time, not UTC, at the start of a new day', () => {
    // 2026-03-01T04:30:00Z is 2026-02-28 23:30 in America/Bogota (UTC-5)
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T04:30:00Z'))

    expect(currentPeriod()).toBe('2026-02')
    expect(currentDayOfMonth()).toBe(28)
  })

  it('crosses into the next Bogota day once UTC offset passes 5am', () => {
    // 2026-03-01T05:30:00Z is 2026-03-01 00:30 in America/Bogota (UTC-5)
    jest.useFakeTimers().setSystemTime(new Date('2026-03-01T05:30:00Z'))

    expect(currentPeriod()).toBe('2026-03')
    expect(currentDayOfMonth()).toBe(1)
  })
})
