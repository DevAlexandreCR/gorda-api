import RechargeRepository from '../RechargeRepository'
import RechargeRecord from '../../Models/RechargeRecord'
import DriverRecord from '../../Models/DriverRecord'

jest.mock('../../Models/RechargeRecord', () => ({
  findAndCountAll: jest.fn(),
  create: jest.fn(),
}))

jest.mock('../../Models/DriverRecord', () => ({
  findOne: jest.fn(),
}))

// sequelize is imported as a default export (`import sequelize from '...'`).
// Using __esModule: true tells Jest to treat this as an ES module so that
// `sequelize_1.default` in the compiled output resolves to our mock object.
jest.mock('../../Database/sequelize', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}))

// buildDriverAvailability is called inside mapDriver — provide a lightweight stub
jest.mock('../../Services/drivers/DriverAvailability', () => ({
  buildDriverAvailability: jest.fn(() => 'available'),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DriverRecord-like model stub that mapDriver can handle.
 *
 * The `get({ plain: true })` method returns a live reference to the same object
 * whose properties are exposed directly on the stub. This means mutations like
 * `driver.balance = newValue` are reflected when mapDriver later calls
 * `driver.get({ plain: true }).balance`.
 */
function makeDriverModel(overrides: Record<string, any> = {}) {
  const stub: Record<string, any> = {
    id: 'drv-1',
    name: 'Test',
    email: 'test@test.com',
    password: null,
    phone: '3001234',
    phone2: null,
    docType: 'CC',
    paymentMode: 'monthly',
    document: '12345',
    photoUrl: null,
    vehicle: {},
    device: null,
    balance: 1000,
    enabled_at: 1000000,
    created_at: 900000,
    last_connection: 800000,
    selected_vehicle_id: null,
    ...overrides,
    // `get` returns the stub itself so that mutations to stub.balance etc. are visible
    get: (_opts: any) => stub,
    save: jest.fn().mockResolvedValue(undefined),
  }
  return stub
}

/** Build a minimal RechargeRecord-like model stub that mapRecharge can handle. */
function makeRechargeModel(overrides: Record<string, any> = {}) {
  const plain = {
    id: 'rch-1',
    driverId: 'drv-1',
    amount: 500,
    balanceBefore: 1000,
    balanceAfter: 1500,
    createdByUid: 'uid-admin',
    createdByName: 'Admin',
    note: null,
    created_at: 1700000000,
    ...overrides,
  }
  return { get: ({ plain: _p }: any) => plain }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RechargeRepository.create()', () => {
  let repository: RechargeRepository
  let mockTxn: { commit: jest.Mock; rollback: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new RechargeRepository()

    mockTxn = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    }

    const sequelizeMock = require('../../Database/sequelize')
    sequelizeMock.default.transaction.mockResolvedValue(mockTxn)
  })

  describe('positive recharge', () => {
    it('creates a recharge record and returns driver with balanceAfter = before + amount', async () => {
      const driver = makeDriverModel({ balance: 1000, paymentMode: 'monthly' })
      ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)

      const rechargeModel = makeRechargeModel({
        amount: 500,
        balanceBefore: 1000,
        balanceAfter: 1500,
      })
      ;(RechargeRecord.create as jest.Mock).mockResolvedValue(rechargeModel)

      const result = await repository.create({
        driverId: 'drv-1',
        amount: 500,
        createdBy: { uid: 'uid-admin', name: 'Admin' },
      })

      expect(result.recharge.balanceBefore).toBe(1000)
      expect(result.recharge.balanceAfter).toBe(1500)
      expect(result.recharge.amount).toBe(500)
      expect(result.driver.balance).toBe(1500)
      expect(mockTxn.commit).toHaveBeenCalledTimes(1)
      expect(mockTxn.rollback).not.toHaveBeenCalled()
    })

    it('passes the transaction to DriverRecord.findOne and RechargeRecord.create', async () => {
      const driver = makeDriverModel({ balance: 200 })
      ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)

      const rechargeModel = makeRechargeModel({
        amount: 100,
        balanceBefore: 200,
        balanceAfter: 300,
      })
      ;(RechargeRecord.create as jest.Mock).mockResolvedValue(rechargeModel)

      await repository.create({
        driverId: 'drv-1',
        amount: 100,
        createdBy: { uid: 'uid-1', name: 'Operator' },
      })

      const findOneCall = (DriverRecord.findOne as jest.Mock).mock.calls[0][0]
      expect(findOneCall.transaction).toBe(mockTxn)
      expect(findOneCall.lock).toBe(true)

      const createCall = (RechargeRecord.create as jest.Mock).mock.calls[0][1]
      expect(createCall.transaction).toBe(mockTxn)
    })
  })

  describe('negative adjustment', () => {
    it('amount is negative — still creates record correctly', async () => {
      const driver = makeDriverModel({ balance: 1000, paymentMode: 'monthly' })
      ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)

      const rechargeModel = makeRechargeModel({
        amount: -200,
        balanceBefore: 1000,
        balanceAfter: 800,
      })
      ;(RechargeRecord.create as jest.Mock).mockResolvedValue(rechargeModel)

      const result = await repository.create({
        driverId: 'drv-1',
        amount: -200,
        createdBy: { uid: 'uid-admin', name: 'Admin' },
      })

      expect(result.recharge.amount).toBe(-200)
      expect(result.recharge.balanceAfter).toBe(800)
      expect(RechargeRecord.create).toHaveBeenCalledTimes(1)
      expect(mockTxn.commit).toHaveBeenCalledTimes(1)
    })

    it('percentage driver with balanceAfter <= 0 does not throw and commits', async () => {
      const driver = makeDriverModel({
        balance: 100,
        paymentMode: 'percentage',
        enabled_at: 1000000,
      })
      ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)

      const rechargeModel = makeRechargeModel({
        amount: -200,
        balanceBefore: 100,
        balanceAfter: -100,
      })
      ;(RechargeRecord.create as jest.Mock).mockResolvedValue(rechargeModel)

      const result = await repository.create({
        driverId: 'drv-1',
        amount: -200,
        createdBy: { uid: 'uid-admin', name: 'Admin' },
      })

      expect(result.recharge.balanceAfter).toBe(-100)
      expect(mockTxn.commit).toHaveBeenCalledTimes(1)
    })
  })

  describe('unknown driver', () => {
    it('throws "Driver not found" and rolls back when driver does not exist', async () => {
      ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(null)

      await expect(
        repository.create({
          driverId: 'unknown-id',
          amount: 500,
          createdBy: { uid: 'uid-admin', name: 'Admin' },
        })
      ).rejects.toThrow('Driver not found')

      expect(mockTxn.rollback).toHaveBeenCalledTimes(1)
      expect(RechargeRecord.create).not.toHaveBeenCalled()
      expect(mockTxn.commit).not.toHaveBeenCalled()
    })
  })
})

describe('RechargeRepository.listForDriver()', () => {
  let repository: RechargeRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new RechargeRepository()
  })

  describe('empty list', () => {
    it('returns { rows: [], total: 0 } when no records exist', async () => {
      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      const result = await repository.listForDriver('drv-1')

      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('list returns rows', () => {
    it('returns results ordered newest-first (created_at DESC)', async () => {
      const olderRecharge = makeRechargeModel({ id: 'rch-1', created_at: 1700000000 })
      const newerRecharge = makeRechargeModel({ id: 'rch-2', created_at: 1700000100 })

      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({
        count: 2,
        rows: [newerRecharge, olderRecharge],
      })

      const result = await repository.listForDriver('drv-1')

      expect(result.total).toBe(2)
      expect(result.rows).toHaveLength(2)

      const callArg = (RechargeRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.order).toEqual([['created_at', 'DESC']])
    })

    it('maps recharge records correctly', async () => {
      const rechargeModel = makeRechargeModel({
        id: 'rch-42',
        driverId: 'drv-1',
        amount: 300,
        balanceBefore: 700,
        balanceAfter: 1000,
        createdByUid: 'uid-xyz',
        createdByName: 'Operator X',
        note: 'Top-up',
        created_at: 1700000999,
      })

      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({
        count: 1,
        rows: [rechargeModel],
      })

      const result = await repository.listForDriver('drv-1')

      expect(result.rows[0]).toEqual({
        id: 'rch-42',
        driverId: 'drv-1',
        amount: 300,
        balanceBefore: 700,
        balanceAfter: 1000,
        createdByUid: 'uid-xyz',
        createdByName: 'Operator X',
        note: 'Top-up',
        created_at: 1700000999,
      })
    })

    it('filters by driverId', async () => {
      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.listForDriver('drv-specific')

      const callArg = (RechargeRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.where).toEqual({ driverId: 'drv-specific' })
    })

    it('uses default perPage of 20 and page 1 when omitted', async () => {
      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.listForDriver('drv-1')

      const callArg = (RechargeRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.limit).toBe(20)
      expect(callArg.offset).toBe(0)
    })

    it('applies custom page and perPage', async () => {
      ;(RechargeRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.listForDriver('drv-1', { page: 3, perPage: 10 })

      const callArg = (RechargeRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.limit).toBe(10)
      expect(callArg.offset).toBe(20) // (3 - 1) * 10
    })
  })
})
