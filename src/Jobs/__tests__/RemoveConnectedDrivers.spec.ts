// ---------------------------------------------------------------------------
// Module mocks — hoisted above imports
// ---------------------------------------------------------------------------

const mockSeedConnectedDrivers = jest.fn()
const mockWatchConnectedDrivers = jest.fn()
const mockRemoveIfStale = jest.fn()
const mockRemoveDriver = jest.fn()
jest.mock('../../Repositories/DriverRepository', () => ({
  __esModule: true,
  default: {
    seedConnectedDrivers: mockSeedConnectedDrivers,
    watchConnectedDrivers: mockWatchConnectedDrivers,
    removeIfStale: mockRemoveIfStale,
    removeDriver: mockRemoveDriver,
  },
}))

const mockReleaseByDriver = jest.fn()
jest.mock('../../Repositories/ActiveVehicleAssignmentRepository', () => ({
  __esModule: true,
  default: {
    releaseByDriver: mockReleaseByDriver,
    releaseByVehicle: jest.fn(),
    acquire: jest.fn(),
    tryAcquire: jest.fn(),
    findByDriver: jest.fn(),
    findByVehicle: jest.fn(),
  },
}))

// Neither service is imported by RemoveConnectedDrivers — mocking them here and
// asserting they are never called is a regression guard for design.md Decision 3
// (silent eviction: no ForceDisconnect call, no FCM push).
const mockSendNotificationTo = jest.fn()
jest.mock('../../Services/firebase/FCM', () => ({
  __esModule: true,
  default: { sendNotificationTo: mockSendNotificationTo, sendDifusionNotification: jest.fn() },
}))

const mockForceDisconnect = jest.fn()
jest.mock('../../Services/drivers/ForceDisconnect', () => ({
  __esModule: true,
  forceDisconnect: (...args: any[]) => mockForceDisconnect(...args),
}))

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { RemoveConnectedDrivers } from '../RemoveConnectedDrivers'
import config from '../../../config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRIVER_STALE_MS = (Number(config.DRIVER_STALE_SECONDS) || 180) * 1000

type LastUpdatedListener = (lastUpdated: {
  driverId: string
  timestamp: number
  lastSeenAt: number | null
}) => void
type OnRemoved = (driverId: string) => void

let watchListener: LastUpdatedListener
let watchOnRemoved: OnRemoved
let intervalCallback: () => void

/** Flush the microtask queue enough times for the removeIfStale().then(async ...) chain to settle. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

function startJob(): RemoveConnectedDrivers {
  const job = new RemoveConnectedDrivers()
  job.execute()
  return job
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RemoveConnectedDrivers', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockSeedConnectedDrivers.mockResolvedValue(undefined)
    mockWatchConnectedDrivers.mockImplementation((listener: LastUpdatedListener, onRemoved: OnRemoved) => {
      watchListener = listener
      watchOnRemoved = onRemoved
    })
    mockRemoveIfStale.mockResolvedValue(false)
    mockReleaseByDriver.mockResolvedValue(undefined)

    jest.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallback = cb
      return 0 as unknown as NodeJS.Timeout
    }) as unknown as typeof global.setInterval)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('evicts a driver whose last_seen_at is older than DRIVER_STALE_SECONDS*1000 (ms-vs-ms comparison)', async () => {
    startJob()
    const now = Date.now()
    watchListener({ driverId: 'drv-stale', timestamp: now, lastSeenAt: now - DRIVER_STALE_MS - 5_000 })
    mockRemoveIfStale.mockResolvedValue(true)

    const logSpy = jest.spyOn(console, 'log').mockImplementation()

    intervalCallback()
    await flush()

    expect(mockRemoveIfStale).toHaveBeenCalledWith('drv-stale', expect.any(Number))
    expect(mockReleaseByDriver).toHaveBeenCalledWith('drv-stale')

    const events = logSpy.mock.calls.map(([line]) => JSON.parse(line as string).event)
    expect(events).toEqual(expect.arrayContaining(['heartbeat_timeout', 'heartbeat_timeout_cleanup_completed']))

    logSpy.mockRestore()
  })

  it('never evicts a driver with a fresh heartbeat', async () => {
    startJob()
    const now = Date.now()
    watchListener({ driverId: 'drv-fresh', timestamp: now, lastSeenAt: now - 5_000 })

    intervalCallback()
    await flush()

    expect(mockRemoveIfStale).not.toHaveBeenCalled()
    expect(mockReleaseByDriver).not.toHaveBeenCalled()
  })

  it('releases the vehicle assignment only when the remove-if-stale transaction actually committed', async () => {
    startJob()
    const now = Date.now()
    watchListener({ driverId: 'drv-race', timestamp: now, lastSeenAt: now - DRIVER_STALE_MS - 1_000 })
    // Simulates a concurrent sweep (another API process) already having removed the node.
    mockRemoveIfStale.mockResolvedValue(false)

    intervalCallback()
    await flush()

    expect(mockRemoveIfStale).toHaveBeenCalledWith('drv-race', expect.any(Number))
    expect(mockReleaseByDriver).not.toHaveBeenCalled()
  })

  it('silent eviction never calls ForceDisconnect or sends an FCM notification', async () => {
    startJob()
    const now = Date.now()
    watchListener({ driverId: 'drv-silent', timestamp: now, lastSeenAt: now - DRIVER_STALE_MS - 1_000 })
    mockRemoveIfStale.mockResolvedValue(true)

    intervalCallback()
    await flush()

    expect(mockReleaseByDriver).toHaveBeenCalledWith('drv-silent')
    expect(mockForceDisconnect).not.toHaveBeenCalled()
    expect(mockSendNotificationTo).not.toHaveBeenCalled()
  })

  it('purges the tracker on child_removed (normal disconnect) so it is never evicted or notified later', async () => {
    startJob()
    const now = Date.now()
    watchListener({
      driverId: 'drv-disconnected',
      timestamp: now,
      lastSeenAt: now - DRIVER_STALE_MS - 1_000,
    })

    // Driver disconnects cleanly (or is force-disconnected) before the next sweep tick.
    watchOnRemoved('drv-disconnected')

    intervalCallback()
    await flush()

    expect(mockRemoveIfStale).not.toHaveBeenCalled()
    expect(mockReleaseByDriver).not.toHaveBeenCalled()
    expect(mockForceDisconnect).not.toHaveBeenCalled()
    expect(mockSendNotificationTo).not.toHaveBeenCalled()
  })
})
