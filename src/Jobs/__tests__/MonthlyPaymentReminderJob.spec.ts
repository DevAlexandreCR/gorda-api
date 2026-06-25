// ---------------------------------------------------------------------------
// Module mocks — hoisted above imports
// ---------------------------------------------------------------------------

const mockSettingsGet = jest.fn()
const mockFindUnpaidIds = jest.fn()
const mockFindByDriverId = jest.fn()

jest.mock('../../Container/Container', () => ({
  __esModule: true,
  default: {
    getMonthlyPaymentSettingsRepository: jest.fn(() => ({ get: mockSettingsGet })),
    getMonthlyPaymentRepository: jest.fn(() => ({ findUnpaidMonthlyDriverIds: mockFindUnpaidIds })),
    getDriverTokenRecordRepository: jest.fn(() => ({ findByDriverId: mockFindByDriverId })),
  },
}))

jest.mock('../../Services/firebase/FCM', () => ({
  __esModule: true,
  default: {
    sendNotificationTo: jest.fn(),
  },
}))

jest.mock('../../Services/time/BogotaTime', () => ({
  currentDayOfMonth: jest.fn(),
  currentPeriod: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { sendMonthlyPaymentReminders } from '../MonthlyPaymentReminderJob'
import FCM from '../../Services/firebase/FCM'
import { currentDayOfMonth, currentPeriod } from '../../Services/time/BogotaTime'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultSettings = {
  suggested_amount: 90000,
  auto_disable: true,
  cutoff_day: 4,
  reminder_offsets: [3, 1],
  // reminder days = [4-3=1, 4-1=3]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendMonthlyPaymentReminders()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettingsGet.mockResolvedValue(defaultSettings)
    mockFindUnpaidIds.mockResolvedValue([])
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(1) // a valid reminder day
    ;(currentPeriod as jest.Mock).mockReturnValue('2026-06')
    ;(FCM.sendNotificationTo as jest.Mock).mockResolvedValue(undefined)
  })

  it('returns early without sending FCM when today is not in the reminder days', async () => {
    // cutoff=4, offsets=[3,1] → reminder days=[1,3]; today=2 → no-op
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(2)

    await sendMonthlyPaymentReminders()

    expect(mockFindUnpaidIds).not.toHaveBeenCalled()
    expect(FCM.sendNotificationTo).not.toHaveBeenCalled()
  })

  it('sends FCM with the correct payload when today is a reminder day', async () => {
    // cutoff=4, offsets=[3,1] → reminder days=[1,3]; today=1 → proceed
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(1)
    mockFindUnpaidIds.mockResolvedValue(['drv-1'])
    mockFindByDriverId.mockResolvedValue({ token: 'fcm-token-abc' })

    await sendMonthlyPaymentReminders()

    expect(FCM.sendNotificationTo).toHaveBeenCalledWith(
      'fcm-token-abc',
      expect.objectContaining({
        data: {
          type: 'alert',
          reason: 'monthly_payment_reminder',
          suggested_amount: '90000',
          cutoff_day: '4',
        },
      })
    )
  })

  it('does not send FCM when there are no unpaid drivers', async () => {
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(1)
    mockFindUnpaidIds.mockResolvedValue([])

    await sendMonthlyPaymentReminders()

    expect(FCM.sendNotificationTo).not.toHaveBeenCalled()
  })

  it('pushes driver without token to failed and not to processed', async () => {
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(1)
    mockFindUnpaidIds.mockResolvedValue(['drv-no-token'])
    mockFindByDriverId.mockResolvedValue(null)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    await sendMonthlyPaymentReminders()

    const logged = JSON.parse(consoleSpy.mock.calls[0][0])
    expect(logged.failed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'drv-no-token' })])
    )
    expect(logged.processed).toBe(0)

    consoleSpy.mockRestore()
  })

  it('does not abort the batch when one FCM call throws — remaining drivers are still processed', async () => {
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(1)
    mockFindUnpaidIds.mockResolvedValue(['drv-fail', 'drv-ok'])
    mockFindByDriverId
      .mockResolvedValueOnce({ token: 'token-fail' })
      .mockResolvedValueOnce({ token: 'token-ok' })
    ;(FCM.sendNotificationTo as jest.Mock)
      .mockRejectedValueOnce(new Error('FCM error'))
      .mockResolvedValueOnce(undefined)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    await sendMonthlyPaymentReminders()

    const logged = JSON.parse(consoleSpy.mock.calls[0][0])
    expect(logged.processed).toBe(1)
    expect(logged.failed).toHaveLength(1)
    expect(logged.failed[0]).toEqual(
      expect.objectContaining({ id: 'drv-fail', reason: 'FCM error' })
    )

    consoleSpy.mockRestore()
  })
})
