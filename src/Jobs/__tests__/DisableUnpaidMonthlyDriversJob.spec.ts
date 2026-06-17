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

jest.mock('../../Models/DriverRecord', () => ({
  __esModule: true,
  default: {
    update: jest.fn(),
  },
}))

const mockOnce = jest.fn()
const mockChild = jest.fn(() => ({ once: mockOnce }))
jest.mock('../../Services/firebase/Database', () => ({
  __esModule: true,
  default: {
    dbConnectedDrivers: jest.fn(() => ({ child: mockChild })),
  },
}))

jest.mock('../../Services/firebase/FCM', () => ({
  __esModule: true,
  default: {
    sendNotificationTo: jest.fn(),
  },
}))

const mockForceDisconnect = jest.fn()
jest.mock('../../Services/drivers/ForceDisconnect', () => ({
  __esModule: true,
  forceDisconnect: (...args: any[]) => mockForceDisconnect(...args),
}))

jest.mock('../../Services/time/BogotaTime', () => ({
  currentDayOfMonth: jest.fn(),
  currentPeriod: jest.fn(),
}))

const mockRefreshDrivers = jest.fn()
jest.mock('../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      refreshDrivers: mockRefreshDrivers,
    })),
  },
}))

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { disableUnpaidMonthlyDrivers } from '../DisableUnpaidMonthlyDriversJob'
import DriverRecord from '../../Models/DriverRecord'
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
}

const existsSnapshot = { exists: () => true }
const absentSnapshot = { exists: () => false }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('disableUnpaidMonthlyDrivers()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettingsGet.mockResolvedValue(defaultSettings)
    mockFindUnpaidIds.mockResolvedValue([])
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(4)
    ;(currentPeriod as jest.Mock).mockReturnValue('2026-06')
    ;(DriverRecord.update as jest.Mock).mockResolvedValue(undefined)
    mockRefreshDrivers.mockResolvedValue(undefined)
  })

  it('returns early without updating when today is not the cutoff day', async () => {
    ;(currentDayOfMonth as jest.Mock).mockReturnValue(3)

    await disableUnpaidMonthlyDrivers()

    expect(DriverRecord.update).not.toHaveBeenCalled()
    expect(mockFindUnpaidIds).not.toHaveBeenCalled()
  })

  it('returns early without updating when auto_disable is false', async () => {
    mockSettingsGet.mockResolvedValue({ ...defaultSettings, auto_disable: false })

    await disableUnpaidMonthlyDrivers()

    expect(DriverRecord.update).not.toHaveBeenCalled()
    expect(mockFindUnpaidIds).not.toHaveBeenCalled()
  })

  it('does not update drivers or call refreshDrivers when no unpaid drivers exist', async () => {
    mockFindUnpaidIds.mockResolvedValue([])

    await disableUnpaidMonthlyDrivers()

    expect(DriverRecord.update).not.toHaveBeenCalled()
    expect(mockRefreshDrivers).not.toHaveBeenCalled()
  })

  it('calls forceDisconnect for online drivers and not FCM', async () => {
    mockFindUnpaidIds.mockResolvedValue(['drv-online'])
    mockOnce.mockResolvedValue(existsSnapshot)
    mockForceDisconnect.mockResolvedValue(undefined)

    await disableUnpaidMonthlyDrivers()

    expect(mockForceDisconnect).toHaveBeenCalledWith('drv-online', 'monthly_payment_overdue')
    expect(FCM.sendNotificationTo).not.toHaveBeenCalled()
  })

  it('sends FCM alert for offline drivers with a valid token', async () => {
    mockFindUnpaidIds.mockResolvedValue(['drv-offline'])
    mockOnce.mockResolvedValue(absentSnapshot)
    mockFindByDriverId.mockResolvedValue({ token: 'fcm-token-123' })
    ;(FCM.sendNotificationTo as jest.Mock).mockResolvedValue(undefined)

    await disableUnpaidMonthlyDrivers()

    expect(FCM.sendNotificationTo).toHaveBeenCalledWith(
      'fcm-token-123',
      expect.objectContaining({
        data: { type: 'alert', reason: 'monthly_payment_overdue' },
      })
    )
    expect(mockForceDisconnect).not.toHaveBeenCalled()
  })

  it('pushes offline driver without token to failed and not to processed', async () => {
    mockFindUnpaidIds.mockResolvedValue(['drv-no-token'])
    mockOnce.mockResolvedValue(absentSnapshot)
    mockFindByDriverId.mockResolvedValue(null)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    await disableUnpaidMonthlyDrivers()

    const logged = JSON.parse(consoleSpy.mock.calls[0][0])
    expect(logged.failed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'drv-no-token' })])
    )
    expect(logged.processed).toBe(0)

    consoleSpy.mockRestore()
  })

  it('does not abort the batch when one driver throws — remaining drivers are still processed', async () => {
    mockFindUnpaidIds.mockResolvedValue(['drv-fail', 'drv-online'])
    mockOnce
      .mockResolvedValueOnce(existsSnapshot) // drv-fail is online
      .mockResolvedValueOnce(existsSnapshot) // drv-online is online
    mockForceDisconnect
      .mockRejectedValueOnce(new Error('disconnect failed'))
      .mockResolvedValueOnce(undefined)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    await disableUnpaidMonthlyDrivers()

    const logged = JSON.parse(consoleSpy.mock.calls[0][0])
    expect(logged.processed).toBe(1)
    expect(logged.failed).toHaveLength(1)
    expect(logged.failed[0]).toEqual(
      expect.objectContaining({ id: 'drv-fail', reason: 'disconnect failed' })
    )

    consoleSpy.mockRestore()
  })

  it('calls refreshDrivers once after the batch completes', async () => {
    mockFindUnpaidIds.mockResolvedValue(['drv-online'])
    mockOnce.mockResolvedValue(existsSnapshot)
    mockForceDisconnect.mockResolvedValue(undefined)

    await disableUnpaidMonthlyDrivers()

    expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
  })
})
