import ServiceHistoryRepository from '../ServiceHistoryRepository'
import ServiceHistoryRecord from '../../Models/ServiceHistoryRecord'
import { VehicleRecordInterface } from '../../Interfaces/VehicleRecordInterface'

jest.mock('../../Models/ServiceHistoryRecord', () => ({
  findAll: jest.fn(),
  count: jest.fn(),
}))

// VehicleRepository — class instantiated at module-level in ServiceHistoryRepository.
// Imports run before any same-file top-level statement, so `ServiceHistoryRepository`
// (and its module-level `new VehicleRepository()`) is evaluated before any local const
// would be assigned. Instead, the shared mock fn lives inside the jest.mock factory
// closure (both the constructor mock and the `new VehicleRepository()` call inside
// ServiceHistoryRepository return the SAME object), and is exposed to the test file
// via jest.requireMock so it can be configured/asserted on per test.
jest.mock('../VehicleRepository', () => {
  const sharedInstance = { findByIds: jest.fn() }
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => sharedInstance),
  }
})

const mockFindByIds = (
  jest.requireMock('../VehicleRepository').default() as {
    findByIds: jest.Mock
  }
).findByIds

describe('ServiceHistoryRepository filter normalization', () => {
  let repository: ServiceHistoryRepository

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByIds.mockResolvedValue([])
    repository = new ServiceHistoryRepository()
  })

  describe('Case E: count() canonicalizes clientId with leading + and filters by status', () => {
    it('count({ clientId: "+573001234567@c.us", status: "terminated" }) queries with canonical client_id and only terminated rows', async () => {
      ;(ServiceHistoryRecord.count as jest.Mock).mockResolvedValue(5)

      const result = await repository.count({
        clientId: '+573001234567@c.us',
        status: 'terminated',
      })

      expect(result).toBe(5)
      expect(ServiceHistoryRecord.count).toHaveBeenCalledTimes(1)

      const callArg = (ServiceHistoryRecord.count as jest.Mock).mock.calls[0][0]
      const whereClause = callArg.where

      // When multiple filters are present, buildWhere returns { [Op.and]: [...conditions] }.
      // Symbol keys are invisible to JSON.stringify, so we must inspect the Op.and array
      // directly rather than relying on JSON serialization of the top-level object.
      const { Op } = require('sequelize')
      const conditions: object[] = whereClause[Op.and] ?? [whereClause]

      const conditionsString = JSON.stringify(conditions, (_key, value) => {
        if (typeof value === 'symbol') return value.toString()
        return value
      })

      // clientId must be canonicalized: + and @c.us stripped, digits only
      expect(conditionsString).toContain('"client_id":"573001234567"')
      expect(conditionsString).not.toContain('+573001234567')
      expect(conditionsString).not.toContain('@c.us')

      // status filter must be present so non-terminated rows are excluded
      expect(conditionsString).toContain('"status":"terminated"')
    })
  })

  describe('Case D: clientId filter is canonicalized before querying', () => {
    it('count() strips @c.us suffix from clientId and queries with digits-only client_id', async () => {
      ;(ServiceHistoryRecord.count as jest.Mock).mockResolvedValue(3)

      await repository.count({ clientId: '573001234567@c.us' })

      expect(ServiceHistoryRecord.count).toHaveBeenCalledTimes(1)

      const callArg = (ServiceHistoryRecord.count as jest.Mock).mock.calls[0][0]

      const whereClause = callArg.where

      const whereString = JSON.stringify(whereClause, (_key, value) => {
        if (typeof value === 'symbol') return value.toString()
        return value
      })

      expect(whereString).toContain('"client_id":"573001234567"')
    })

    it('listPage() strips @c.us suffix from clientId in the where clause', async () => {
      ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

      await repository.listPage({ clientId: '573001234567@c.us' })

      expect(ServiceHistoryRecord.findAll).toHaveBeenCalledTimes(1)

      const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]

      const whereClause = callArg.where

      const whereString = JSON.stringify(whereClause, (_key, value) => {
        if (typeof value === 'symbol') return value.toString()
        return value
      })

      expect(whereString).toContain('"client_id":"573001234567"')
    })

    it('count() does NOT pass polluted @c.us value to the query', async () => {
      ;(ServiceHistoryRecord.count as jest.Mock).mockResolvedValue(0)

      await repository.count({ clientId: '573001234567@c.us' })

      const callArg = (ServiceHistoryRecord.count as jest.Mock).mock.calls[0][0]
      const whereString = JSON.stringify(callArg.where, (_key, value) => {
        if (typeof value === 'symbol') return value.toString()
        return value
      })

      expect(whereString).not.toContain('@c.us')
    })
  })
})

describe('ServiceHistoryRepository.listPage vehicle attachment', () => {
  let repository: ServiceHistoryRepository

  function makeVehicle(overrides: Partial<VehicleRecordInterface> = {}): VehicleRecordInterface {
    return {
      id: 'veh-1',
      plate: 'ABC123',
      brand: 'Toyota',
      model: 'Yaris',
      color: { name: 'White', hex: '#FFFFFF' },
      photoUrl: null,
      soat_exp: null,
      tec_exp: null,
      enabled: true,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      ...overrides,
    }
  }

  function makeRow(overrides: Record<string, any> = {}) {
    const plain = {
      id: 'svc-1',
      client_id: '573001234567',
      driver_id: 'drv-1',
      vehicle_id: null,
      status: 'terminated',
      created_at: 1,
      ...overrides,
    }
    return { get: (_opts: any) => plain }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new ServiceHistoryRepository()
  })

  it('attaches vehicle.plate for a row with a resolvable vehicle_id', async () => {
    const row = makeRow({ id: 'svc-1', vehicle_id: 'veh-1' })
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([row])
    mockFindByIds.mockResolvedValue([makeVehicle({ id: 'veh-1', plate: 'ABC123' })])

    const result = await repository.listPage({})

    expect(result).toHaveLength(1)
    expect(result[0].vehicle).toEqual({
      plate: 'ABC123',
      brand: 'Toyota',
      model: 'Yaris',
      color: { name: 'White', hex: '#FFFFFF' },
    })
  })

  it('sets vehicle: null and keeps the row when vehicle_id is null or unresolved', async () => {
    const rowWithNullId = makeRow({ id: 'svc-null', vehicle_id: null })
    const rowWithUnresolvedId = makeRow({ id: 'svc-unresolved', vehicle_id: 'veh-missing' })
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([
      rowWithNullId,
      rowWithUnresolvedId,
    ])
    // 'veh-missing' is requested but not returned by the repo (unresolved FK)
    mockFindByIds.mockResolvedValue([])

    const result = await repository.listPage({})

    expect(result).toHaveLength(2)
    expect(result[0].vehicle).toBeNull()
    expect(result[1].vehicle).toBeNull()
  })

  it('calls VehicleRepository.findByIds exactly once for the page (no N+1)', async () => {
    const rows = [
      makeRow({ id: 'svc-1', vehicle_id: 'veh-1' }),
      makeRow({ id: 'svc-2', vehicle_id: 'veh-2' }),
      makeRow({ id: 'svc-3', vehicle_id: 'veh-1' }),
      makeRow({ id: 'svc-4', vehicle_id: null }),
    ]
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue(rows)
    mockFindByIds.mockResolvedValue([
      makeVehicle({ id: 'veh-1', plate: 'ABC123' }),
      makeVehicle({ id: 'veh-2', plate: 'XYZ789' }),
    ])

    const result = await repository.listPage({})

    expect(mockFindByIds).toHaveBeenCalledTimes(1)
    // distinct, non-null vehicle ids only
    expect(mockFindByIds).toHaveBeenCalledWith(expect.arrayContaining(['veh-1', 'veh-2']))
    expect((mockFindByIds.mock.calls[0][0] as string[]).length).toBe(2)
    expect(result[0].vehicle?.plate).toBe('ABC123')
    expect(result[1].vehicle?.plate).toBe('XYZ789')
    expect(result[2].vehicle?.plate).toBe('ABC123')
    expect(result[3].vehicle).toBeNull()
  })
})

describe('ServiceHistoryRepository deducted_value passthrough', () => {
  let repository: ServiceHistoryRepository

  function makeRow(overrides: Record<string, any> = {}) {
    const plain = {
      id: 'svc-1',
      client_id: '573001234567',
      driver_id: 'drv-1',
      vehicle_id: null,
      status: 'terminated',
      created_at: 1,
      deducted_value: 0,
      ...overrides,
    }
    return { get: (_opts: any) => plain }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByIds.mockResolvedValue([])
    repository = new ServiceHistoryRepository()
  })

  it('listPage() includes deducted_value per row, sourced from the column', async () => {
    const row = makeRow({ id: 'svc-1', deducted_value: 2000 })
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([row])

    const result = await repository.listPage({})

    expect(result).toHaveLength(1)
    expect((result[0] as any).deducted_value).toBe(2000)
  })

  it('listPage() returns deducted_value: 0 (not null) for a legacy row where the column defaulted', async () => {
    // Legacy row: deducted_value was never explicitly set, so the DB default (0) applies.
    const legacyRow = makeRow({ id: 'svc-legacy', deducted_value: 0 })
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([legacyRow])

    const result = await repository.listPage({})

    expect(result).toHaveLength(1)
    expect((result[0] as any).deducted_value).toBe(0)
    expect((result[0] as any).deducted_value).not.toBeNull()
  })

  it('listByDriver() includes deducted_value per row, defaulting to 0 for legacy rows', async () => {
    const rows = [
      makeRow({ id: 'svc-1', deducted_value: 1500 }),
      makeRow({ id: 'svc-legacy', deducted_value: 0 }),
    ]
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue(rows)

    const result = await repository.listByDriver('drv-1')

    expect(result).toHaveLength(2)
    expect((result[0] as any).deducted_value).toBe(1500)
    expect((result[1] as any).deducted_value).toBe(0)
    expect((result[1] as any).deducted_value).not.toBeNull()
  })
})
