import { Op } from 'sequelize'
import MonthlyPaymentRepository from '../MonthlyPaymentRepository'
import MonthlyPaymentRecord from '../../Models/MonthlyPaymentRecord'
import DriverRecord from '../../Models/DriverRecord'
import { currentPeriod } from '../../Services/time/BogotaTime'

jest.mock('../../Models/MonthlyPaymentRecord', () => ({
  create: jest.fn(),
  findAndCountAll: jest.fn(),
  count: jest.fn(),
}))

jest.mock('../../Models/DriverRecord', () => ({
  findOne: jest.fn(),
  findAll: jest.fn(),
}))

// sequelize is imported as a default export (`import sequelize from '...'`).
// __esModule: true tells Jest to treat this as an ES module so that
// `sequelize_1.default` in the compiled output resolves to our mock object.
jest.mock('../../Database/sequelize', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}))

jest.mock('../../Services/drivers/DriverAvailability', () => ({
  buildDriverAvailability: jest.fn(() => 'available'),
}))

jest.mock('../../Services/time/BogotaTime', () => ({
  currentPeriod: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    balance: 0,
    enabled_at: 0,
    created_at: 900000,
    last_connection: 800000,
    selected_vehicle_id: null,
    ...overrides,
    get: (_opts: any) => stub,
    save: jest.fn().mockResolvedValue(undefined),
  }
  return stub
}

function makePaymentModel(overrides: Record<string, any> = {}) {
  const plain = {
    id: 'pmt-1',
    driverId: 'drv-1',
    period: '2026-06',
    amount: 90000,
    createdByUid: 'uid-admin',
    createdByName: 'Admin',
    note: null,
    created_at: 1700000000,
    ...overrides,
  }
  return { get: ({ plain: _p }: any) => plain }
}

/** Extract the Op.and array (or wrap single where in array) for assertion. */
function extractConditions(where: any): any[] {
  return where[Op.and] ?? [where]
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

describe('MonthlyPaymentRepository.create()', () => {
  let repository: MonthlyPaymentRepository
  let mockTxn: { commit: jest.Mock; rollback: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new MonthlyPaymentRepository()

    mockTxn = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    }

    const sequelizeMock = require('../../Database/sequelize')
    sequelizeMock.default.transaction.mockResolvedValue(mockTxn)
    ;(currentPeriod as jest.Mock).mockReturnValue('2026-06')
  })

  it('re-enables the driver when the payment period equals the current period', async () => {
    const driver = makeDriverModel({ enabled_at: 0 })
    ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)
    ;(MonthlyPaymentRecord.create as jest.Mock).mockResolvedValue(
      makePaymentModel({ period: '2026-06' })
    )

    const result = await repository.create({
      driverId: 'drv-1',
      period: '2026-06',
      amount: 90000,
      createdBy: { uid: 'uid-admin', name: 'Admin' },
    })

    expect(driver.enabled_at).toBeGreaterThan(0)
    expect(driver.save).toHaveBeenCalledWith({ transaction: mockTxn })
    expect(result.driver.enabled_at).toBeGreaterThan(0)
    expect(mockTxn.commit).toHaveBeenCalledTimes(1)
    expect(mockTxn.rollback).not.toHaveBeenCalled()
  })

  it('does not re-enable the driver when the payment period is in the past', async () => {
    const driver = makeDriverModel({ enabled_at: 0 })
    ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)
    ;(MonthlyPaymentRecord.create as jest.Mock).mockResolvedValue(
      makePaymentModel({ period: '2026-05' })
    )

    const result = await repository.create({
      driverId: 'drv-1',
      period: '2026-05',
      amount: 90000,
      createdBy: { uid: 'uid-admin', name: 'Admin' },
    })

    expect(driver.enabled_at).toBe(0)
    expect(driver.save).not.toHaveBeenCalled()
    expect(result.driver.enabled_at).toBe(0)
    expect(mockTxn.commit).toHaveBeenCalledTimes(1)
  })

  it('does not change enable state when the payment period is in the future', async () => {
    const driver = makeDriverModel({ enabled_at: 0 })
    ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)
    ;(MonthlyPaymentRecord.create as jest.Mock).mockResolvedValue(
      makePaymentModel({ period: '2026-07' })
    )

    const result = await repository.create({
      driverId: 'drv-1',
      period: '2026-07',
      amount: 90000,
      createdBy: { uid: 'uid-admin', name: 'Admin' },
    })

    expect(driver.enabled_at).toBe(0)
    expect(driver.save).not.toHaveBeenCalled()
    expect(result.driver.enabled_at).toBe(0)
    expect(mockTxn.commit).toHaveBeenCalledTimes(1)
  })

  it('allows a zero amount payment', async () => {
    const driver = makeDriverModel({ enabled_at: 0 })
    ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(driver)
    ;(MonthlyPaymentRecord.create as jest.Mock).mockResolvedValue(
      makePaymentModel({ period: '2026-06', amount: 0 })
    )

    const result = await repository.create({
      driverId: 'drv-1',
      period: '2026-06',
      amount: 0,
      createdBy: { uid: 'uid-admin', name: 'Admin' },
    })

    expect(result.payment.amount).toBe(0)
    expect(MonthlyPaymentRecord.create).toHaveBeenCalledTimes(1)
    expect(mockTxn.commit).toHaveBeenCalledTimes(1)
  })

  it('throws "Driver not found" and rolls back when the driver does not exist', async () => {
    ;(DriverRecord.findOne as jest.Mock).mockResolvedValue(null)

    await expect(
      repository.create({
        driverId: 'unknown-id',
        period: '2026-06',
        amount: 90000,
        createdBy: { uid: 'uid-admin', name: 'Admin' },
      })
    ).rejects.toThrow('Driver not found')

    expect(mockTxn.rollback).toHaveBeenCalledTimes(1)
    expect(MonthlyPaymentRecord.create).not.toHaveBeenCalled()
    expect(mockTxn.commit).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// findUnpaidMonthlyDriverIds()
// ---------------------------------------------------------------------------

describe('MonthlyPaymentRepository.findUnpaidMonthlyDriverIds()', () => {
  let repository: MonthlyPaymentRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new MonthlyPaymentRepository()
  })

  it('queries with paymentMode = monthly, enabled_at > 0, and a NOT EXISTS anti-join on the period', async () => {
    ;(DriverRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.findUnpaidMonthlyDriverIds('2026-06')

    const callArg = (DriverRecord.findAll as jest.Mock).mock.calls[0][0]
    const conditions = extractConditions(callArg.where)

    expect(conditions).toEqual(
      expect.arrayContaining([{ paymentMode: 'monthly' }, { enabled_at: { [Op.gt]: 0 } }])
    )

    const literalCondition = conditions.find((c: any) => typeof c.val === 'string') as any
    expect(literalCondition).toBeDefined()
    expect(literalCondition.val).toContain('NOT EXISTS')
    expect(literalCondition.val).toContain('driver_monthly_payments')
    expect(callArg.replacements).toEqual({ period: '2026-06' })
  })

  it('returns driver ids excluding paid, disabled, and percentage drivers (filtering is delegated to the DB query)', async () => {
    // The repository itself only maps whatever DriverRecord.findAll returns;
    // the exclusion logic (paid/disabled/percentage) is expressed in the where
    // clause asserted above. Here we verify the mapping of the query result.
    ;(DriverRecord.findAll as jest.Mock).mockResolvedValue([
      { id: 'drv-unpaid-1' },
      { id: 'drv-unpaid-2' },
    ])

    const result = await repository.findUnpaidMonthlyDriverIds('2026-06')

    expect(result).toEqual(['drv-unpaid-1', 'drv-unpaid-2'])
  })

  it('returns an empty array when there are no unpaid monthly drivers', async () => {
    ;(DriverRecord.findAll as jest.Mock).mockResolvedValue([])

    const result = await repository.findUnpaidMonthlyDriverIds('2026-06')

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// hasPaymentForPeriod()
// ---------------------------------------------------------------------------

describe('MonthlyPaymentRepository.hasPaymentForPeriod()', () => {
  let repository: MonthlyPaymentRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new MonthlyPaymentRepository()
  })

  it('returns true when a payment row exists for the driver and period', async () => {
    ;(MonthlyPaymentRecord.count as jest.Mock).mockResolvedValue(1)

    const result = await repository.hasPaymentForPeriod('drv-1', '2026-06')

    expect(result).toBe(true)
    expect(MonthlyPaymentRecord.count).toHaveBeenCalledWith({
      where: { driverId: 'drv-1', period: '2026-06' },
    })
  })

  it('returns false when no payment row exists for the driver and period', async () => {
    ;(MonthlyPaymentRecord.count as jest.Mock).mockResolvedValue(0)

    const result = await repository.hasPaymentForPeriod('drv-1', '2026-06')

    expect(result).toBe(false)
  })
})
