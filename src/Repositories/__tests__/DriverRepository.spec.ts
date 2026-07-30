// ---------------------------------------------------------------------------
// Module mocks — hoisted above imports
// ---------------------------------------------------------------------------

// removeIfStale() runs an RTDB transaction: the mock invokes the update
// function synchronously against `mockRtdbCurrentValue` (the node state the
// test wants to simulate) and records what it returned so tests can assert
// abort-vs-commit — `undefined` means "abort, no write", `null` means "commit
// a delete". Same shape used for the heartbeat transaction in
// DriverAppController.spec.ts.
let mockRtdbCurrentValue: any = null
let mockRtdbTransactionUpdateResult: any
const mockChildTransaction = jest.fn((updateFn: (current: any) => any) => {
  mockRtdbTransactionUpdateResult = updateFn(mockRtdbCurrentValue)
  return Promise.resolve({
    committed: mockRtdbTransactionUpdateResult !== undefined,
    snapshot: { val: () => mockRtdbTransactionUpdateResult },
  })
})
const mockChildRemove = jest.fn().mockResolvedValue(undefined)
const mockChild = jest.fn(() => ({
  transaction: mockChildTransaction,
  remove: mockChildRemove,
}))
const mockOn = jest.fn()
const mockGet = jest.fn()
jest.mock('../../Services/firebase/Database', () => ({
  __esModule: true,
  default: {
    dbConnectedDrivers: jest.fn(() => ({
      child: mockChild,
      on: mockOn,
      get: mockGet,
    })),
  },
}))

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import DriverRepository from '../DriverRepository'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DriverRepository.removeIfStale', () => {
  const STALE_THRESHOLD = 1_700_000_000_000

  beforeEach(() => {
    jest.clearAllMocks()
    mockRtdbCurrentValue = null
    mockRtdbTransactionUpdateResult = undefined
  })

  it('removes a stale node and resolves true', async () => {
    mockRtdbCurrentValue = { id: 'drv-1', last_seen_at: STALE_THRESHOLD - 5_000 }

    const removed = await DriverRepository.removeIfStale('drv-1', STALE_THRESHOLD)

    expect(removed).toBe(true)
    expect(mockChild).toHaveBeenCalledWith('drv-1')
    // Removing a node inside an RTDB transaction is done by returning null.
    expect(mockRtdbTransactionUpdateResult).toBeNull()
  })

  it('aborts without writing when the node is absent (concurrent-sweep safety)', async () => {
    mockRtdbCurrentValue = null

    const removed = await DriverRepository.removeIfStale('drv-2', STALE_THRESHOLD)

    expect(removed).toBe(false)
    expect(mockRtdbTransactionUpdateResult).toBeUndefined()
  })

  it('aborts without writing when last_seen_at is still fresh (concurrent-sweep safety)', async () => {
    mockRtdbCurrentValue = { id: 'drv-3', last_seen_at: STALE_THRESHOLD + 1_000 }

    const removed = await DriverRepository.removeIfStale('drv-3', STALE_THRESHOLD)

    expect(removed).toBe(false)
    expect(mockRtdbTransactionUpdateResult).toBeUndefined()
  })

  it('treats last_seen_at exactly at the threshold as fresh (not yet stale)', async () => {
    mockRtdbCurrentValue = { id: 'drv-4', last_seen_at: STALE_THRESHOLD }

    const removed = await DriverRepository.removeIfStale('drv-4', STALE_THRESHOLD)

    expect(removed).toBe(false)
    expect(mockRtdbTransactionUpdateResult).toBeUndefined()
  })
})

describe('DriverRepository.watchConnectedDrivers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('subscribes to child_added, child_changed, and child_removed', () => {
    DriverRepository.watchConnectedDrivers(jest.fn(), jest.fn())

    expect(mockOn).toHaveBeenCalledWith('child_added', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('child_changed', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('child_removed', expect.any(Function))
  })

  it('invokes onRemoved with the driver id when child_removed fires', () => {
    const listener = jest.fn()
    const onRemoved = jest.fn()

    DriverRepository.watchConnectedDrivers(listener, onRemoved)

    const childRemovedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'child_removed'
    )?.[1]

    childRemovedHandler({ val: () => ({ id: 'drv-9' }), key: 'drv-9' })

    expect(onRemoved).toHaveBeenCalledWith('drv-9')
    expect(listener).not.toHaveBeenCalled()
  })

  it('falls back to the snapshot key when the removed value has no id', () => {
    const onRemoved = jest.fn()

    DriverRepository.watchConnectedDrivers(jest.fn(), onRemoved)

    const childRemovedHandler = mockOn.mock.calls.find(
      ([event]) => event === 'child_removed'
    )?.[1]

    childRemovedHandler({ val: () => null, key: 'drv-10' })

    expect(onRemoved).toHaveBeenCalledWith('drv-10')
  })
})
