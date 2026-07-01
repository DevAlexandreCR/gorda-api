import DriverRecordRepository from '../DriverRecordRepository'
import DriverRecord from '../../Models/DriverRecord'
import sequelize from '../../Database/sequelize'

jest.mock('../../Models/DriverRecord', () => ({
  findAndCountAll: jest.fn(),
  findAll: jest.fn(),
}))

// buildDriverAvailability is called inside mapDriver — provide a lightweight stub
jest.mock('../../Services/drivers/DriverAvailability', () => ({
  buildDriverAvailability: jest.fn(() => 'available'),
}))

// sequelize is imported transitively through DriverRecord's model init; mock it
// so the test process does not attempt a real DB connection.
// query() is also called by list() to bulk-fetch selected vehicles and active assignments.
jest.mock('../../Database/sequelize', () => ({
  define: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DriverRecord-like plain object that mapDriver can handle. */
function makeDriverPlain(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'drv-1',
    name: 'John Driver',
    email: 'john@example.com',
    password: null,
    phone: '3001234567',
    phone2: null,
    docType: 'CC',
    paymentMode: 'monthly',
    document: '123456789',
    photoUrl: null,
    vehicle: { plate: 'ABC123' },
    device: null,
    balance: 0,
    enabled_at: 1_000_000,
    created_at: 900_000,
    last_connection: 800_000,
    selected_vehicle_id: null,
    ...overrides,
  }
}

/** Return a Sequelize-model stub that exposes get({ plain: true }). */
function makeDriverModel(plain: Record<string, any>) {
  return { get: ({ plain: _p }: any) => plain }
}

/** Extract the Op.and array (or wrap single where in array) for assertion. */
function extractConditions(where: Record<symbol | string, any>): object[] {
  const { Op } = require('sequelize')
  return where[Op.and] ?? [where]
}

/** Serialize an object to JSON, including Symbol keys and converting Symbol values to strings. */
function serializeWhere(obj: object): string {
  function serialize(val: any): any {
    if (val === null || val === undefined) return val
    if (typeof val === 'symbol') return val.toString()
    if (Array.isArray(val)) return val.map(serialize)
    if (typeof val === 'object') {
      const result: Record<string, any> = {}
      for (const key of Object.keys(val)) {
        result[key] = serialize((val as any)[key])
      }
      for (const sym of Object.getOwnPropertySymbols(val)) {
        result[sym.toString()] = serialize((val as any)[sym])
      }
      return result
    }
    return val
  }
  return JSON.stringify(serialize(obj))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DriverRecordRepository.index()', () => {
  let repository: DriverRecordRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new DriverRecordRepository()
  })

  it('returns selected_vehicle resolved for a driver with a selected_vehicle_id', async () => {
    const plain = makeDriverPlain({ selected_vehicle_id: 'veh-1' })
    ;(DriverRecord.findAll as jest.Mock).mockResolvedValue([makeDriverModel(plain)])
    ;(sequelize.query as jest.Mock).mockResolvedValueOnce([
      {
        id: 'veh-1',
        plate: 'ABC123',
        brand: 'Mazda',
        model: 'Cx30',
        color: { name: 'white', hex: '#ffffff' },
        photo_url: 'https://vehicle.example/photo.jpg',
        soat_exp: null,
        tec_exp: null,
        enabled: true,
        created_at: new Date('2026-06-15T00:00:00Z'),
        updated_at: new Date('2026-06-15T00:00:00Z'),
      },
    ])

    const result = await repository.index()

    expect(result).toHaveLength(1)
    expect(result[0].selected_vehicle).toMatchObject({
      id: 'veh-1',
      plate: 'ABC123',
      photoUrl: 'https://vehicle.example/photo.jpg',
    })
  })

  it('returns selected_vehicle: null for a driver without a selected_vehicle_id', async () => {
    const plain = makeDriverPlain({ selected_vehicle_id: null })
    ;(DriverRecord.findAll as jest.Mock).mockResolvedValue([makeDriverModel(plain)])

    const result = await repository.index()

    expect(result).toHaveLength(1)
    expect(result[0].selected_vehicle).toBeNull()
  })
})

describe('DriverRecordRepository.list()', () => {
  let repository: DriverRecordRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new DriverRecordRepository()
  })

  // --- Default behaviour ---

  describe('defaults: no query params', () => {
    it('uses name ASC sort and perPage 30 when no params are supplied', async () => {
      const plain = makeDriverPlain({ selected_vehicle_id: 'veh-1' })
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({
        count: 1,
        rows: [makeDriverModel(plain)],
      })

      const result = await repository.list({})

      expect(result.total).toBe(1)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].selected_vehicle_id).toBe('veh-1')

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.limit).toBe(30)
      expect(callArg.order).toEqual([['name', 'ASC']])
    })

    it('maps raw selected vehicle photo_url rows to selected_vehicle.photoUrl', async () => {
      const plain = makeDriverPlain({ selected_vehicle_id: 'veh-1' })
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({
        count: 1,
        rows: [makeDriverModel(plain)],
      })
      ;(sequelize.query as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'veh-1',
            plate: 'ABC123',
            brand: 'Mazda',
            model: 'Cx30',
            color: { name: 'white', hex: '#ffffff' },
            photo_url: 'https://vehicle.example/photo.jpg',
            soat_exp: null,
            tec_exp: null,
            enabled: true,
            created_at: new Date('2026-06-15T00:00:00Z'),
            updated_at: new Date('2026-06-15T00:00:00Z'),
          },
        ])
        .mockResolvedValueOnce([])

      const result = await repository.list({})

      expect(result.rows[0].selected_vehicle).toMatchObject({
        id: 'veh-1',
        photoUrl: 'https://vehicle.example/photo.jpg',
      })
      expect((result.rows[0].selected_vehicle as any).photo_url).toBeUndefined()
    })
  })

  // --- filter by status ---

  describe('filter by status', () => {
    it('status="enabled" adds enabled_at > 0 condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ status: 'enabled' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      expect(str).toContain('"enabled_at"')
    })

    it('status="disabled" adds enabled_at = 0 condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ status: 'disabled' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      expect(str).toContain('"enabled_at":0')
    })
  })

  // --- filter by paymentMode ---

  describe('filter by paymentMode', () => {
    it('paymentMode="percentage" adds paymentMode condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ paymentMode: 'percentage' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      expect(str).toContain('"paymentMode":"percentage"')
    })

    it('paymentMode="monthly" adds paymentMode condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ paymentMode: 'monthly' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      expect(str).toContain('"paymentMode":"monthly"')
    })
  })

  // --- filter by inactiveDays (excluding last_connection = 0) ---

  describe('filter by inactiveDays', () => {
    it('inactiveDays=7 adds last_connection > 0 AND last_connection < cutoff', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      const before = Math.floor(Date.now() / 1000)
      await repository.list({ inactiveDays: 7 })
      const after = Math.floor(Date.now() / 1000)

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)

      // Find the last_connection condition among the Op.and array
      const { Op } = require('sequelize')
      const lcCondition = conditions.find((c: any) => c.last_connection !== undefined) as any

      expect(lcCondition).toBeDefined()
      expect(lcCondition.last_connection[Op.gt]).toBe(0)

      const cutoff = lcCondition.last_connection[Op.lt]
      const expectedMin = before - 7 * 86400
      const expectedMax = after - 7 * 86400
      expect(cutoff).toBeGreaterThanOrEqual(expectedMin)
      expect(cutoff).toBeLessThanOrEqual(expectedMax)
    })

    it('inactiveDays filter does NOT match last_connection = 0 (never-connected drivers excluded)', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ inactiveDays: 7 })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const { Op } = require('sequelize')
      const lcCondition = conditions.find((c: any) => c.last_connection !== undefined) as any

      // Op.gt: 0 means last_connection must be > 0, so drivers with last_connection = 0 are excluded
      expect(lcCondition.last_connection[Op.gt]).toBe(0)
    })

    it('inactiveDays=0 is ignored (no last_connection filter added)', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ inactiveDays: 0 })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      // No filters → where is an empty object
      expect(Object.keys(callArg.where)).toHaveLength(0)
    })
  })

  // --- search: vehicle.plate via driver_vehicles JOIN ---

  describe('search on vehicle plate (driver_vehicles JOIN)', () => {
    it('search query includes a literal SQL subquery joining driver_vehicles and vehicles', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ search: 'XYZ' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      // The literal for vehicle plate must use the JOIN-based subquery
      expect(str).toContain('driver_vehicles dv')
      expect(str).toContain('JOIN vehicles v')
      expect(str).toContain('v.plate ILIKE :search')
    })

    it('search query does NOT use the legacy JSONB vehicle extraction', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ search: 'XYZ' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      // The old JSONB path must no longer appear
      expect(str).not.toContain("vehicle->>'plate'")
    })
  })

  // --- filter by needsVehicle ---

  describe('filter by needsVehicle', () => {
    it('needsVehicle=true adds a selected_vehicle_id IS NULL condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ needsVehicle: true })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)

      // Find the literal condition by inspecting its .val property (Symbol-keyed Op.and array)
      const literalCondition = conditions.find((c: any) => typeof c.val === 'string') as any
      expect(literalCondition).toBeDefined()
      expect(literalCondition.val).toContain('selected_vehicle_id')
      expect(literalCondition.val).toContain('IS NULL')
    })

    it('needsVehicle=false does NOT add the selected_vehicle_id condition', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ needsVehicle: false })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      // No filters → where is an empty object
      expect(Object.keys(callArg.where)).toHaveLength(0)
    })
  })

  // --- search: direct fields ---

  describe('search across direct fields (name, email, phone, document)', () => {
    it('search adds iLike conditions for name, email, phone, and document', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ search: 'test' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      const conditions = extractConditions(callArg.where)
      const str = serializeWhere(conditions)

      expect(str).toContain('"name"')
      expect(str).toContain('"email"')
      expect(str).toContain('"phone"')
      expect(str).toContain('"document"')
    })

    it('search wraps the term with % for ILIKE pattern', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ search: 'driver42' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      // The replacement passed to Sequelize must be the %-wrapped pattern
      expect(callArg.replacements.search).toBe('%driver42%')
    })
  })

  // --- sort whitelist rejection ---

  describe('sort whitelist rejection', () => {
    it('throws when sort field is not in the whitelist', async () => {
      await expect(repository.list({ sort: 'some_invalid_field' })).rejects.toThrow(
        /Invalid sort field/
      )
    })

    it('throws for descending sort on an invalid field (e.g. "-password")', async () => {
      await expect(repository.list({ sort: '-password' })).rejects.toThrow(/Invalid sort field/)
    })

    it('does NOT throw for valid sort fields', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      for (const field of ['name', 'created_at', 'last_connection', 'balance']) {
        await expect(repository.list({ sort: field })).resolves.not.toThrow()
        await expect(repository.list({ sort: `-${field}` })).resolves.not.toThrow()
      }
    })

    it('does NOT call findAndCountAll when sort is invalid', async () => {
      await expect(repository.list({ sort: 'malicious; DROP TABLE drivers;' })).rejects.toThrow()
      expect(DriverRecord.findAndCountAll).not.toHaveBeenCalled()
    })
  })

  // --- default sort ---

  describe('default sort', () => {
    it('sorts by name ASC when sort is omitted', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({})

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.order).toEqual([['name', 'ASC']])
    })

    it('sorts DESC when sort field is prefixed with "-"', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ sort: '-balance' })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.order).toEqual([['balance', 'DESC']])
    })
  })

  // --- default perPage ---

  describe('default perPage', () => {
    it('uses limit 30 when perPage is omitted', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({})

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.limit).toBe(30)
    })

    it('uses the provided perPage when explicitly set', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ perPage: 50 })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.limit).toBe(50)
    })
  })

  // --- overshoot page returns [] with correct total ---

  describe('overshoot page returns [] with correct total', () => {
    it('returns empty rows but preserves total when page offset exceeds the dataset', async () => {
      // Simulate Sequelize returning 0 rows for a page beyond the last one
      // (e.g. page 100, perPage 30, but only 5 records exist)
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 5, rows: [] })

      const result = await repository.list({ page: 100, perPage: 30 })

      expect(result.rows).toEqual([])
      expect(result.total).toBe(5)
    })

    it('computes the correct offset for a non-first page', async () => {
      ;(DriverRecord.findAndCountAll as jest.Mock).mockResolvedValue({ count: 0, rows: [] })

      await repository.list({ page: 3, perPage: 20 })

      const callArg = (DriverRecord.findAndCountAll as jest.Mock).mock.calls[0][0]
      expect(callArg.offset).toBe(40) // (3 - 1) * 20
      expect(callArg.limit).toBe(20)
    })
  })
})
