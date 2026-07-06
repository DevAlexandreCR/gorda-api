// These tests exercise the real ServiceHistoryRepository (only the Sequelize
// model call and VehicleRepository are mocked) rather than a mocked
// repository, because the route-flagged classification rule lives in raw SQL
// (design.md Decision 1) executed by Postgres — a mocked findAll() cannot
// evaluate it. Instead we capture the exact SQL text Sequelize would send
// (via literal().val) and assert it encodes each spec scenario, and we
// extract the guarded numeric regex from that captured text to prove
// non-numeric trip_distance resolves without throwing.

import ServiceHistoryRepository from '../../../../Repositories/ServiceHistoryRepository'
import ServiceHistoryRecord from '../../../../Models/ServiceHistoryRecord'

jest.mock('../../../../Models/ServiceHistoryRecord', () => ({
  findAll: jest.fn(),
  count: jest.fn(),
}))

// VehicleRepository — class instantiated at module-level in
// ServiceHistoryRepository. Same pattern as ServiceHistoryRepository.spec.ts:
// the shared mock fn lives inside the jest.mock factory closure and is
// exposed via jest.requireMock.
jest.mock('../../../../Repositories/VehicleRepository', () => {
  const sharedInstance = { findByIds: jest.fn() }
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => sharedInstance),
  }
})

const mockFindByIds = (
  jest.requireMock('../../../../Repositories/VehicleRepository').default() as {
    findByIds: jest.Mock
  }
).findByIds

/**
 * Recursively collects the `.val` string of every Sequelize `literal()`
 * value nested inside `value` (arrays, plain objects, and objects keyed by
 * symbols such as Op.and).
 */
function collectLiteralStrings(value: any, out: string[] = []): string[] {
  if (value === null || value === undefined) return out
  if (typeof value === 'object' && typeof value.val === 'string') {
    out.push(value.val)
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLiteralStrings(item, out))
  } else if (typeof value === 'object') {
    ;[...Object.getOwnPropertySymbols(value), ...Object.keys(value)].forEach((key) =>
      collectLiteralStrings((value as any)[key], out)
    )
  }
  return out
}

/**
 * `JSON.stringify` silently drops properties keyed by a Symbol (e.g.
 * `Op.and`) at every nesting level, not just the top one — a `where` built
 * from nested `buildWhere()` calls (as in `aggregateRouteIntegrity`) has
 * Op.and several levels deep. This converts the whole structure into a
 * plain-key-only tree first (symbol keys relabeled to their `.toString()`,
 * `literal()` values unwrapped to their SQL text) so it can be safely
 * JSON.stringify'd and asserted on.
 */
function serializeWhereForAssertions(value: any): any {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(serializeWhereForAssertions)
  if (typeof value === 'object') {
    if (typeof value.val === 'string') return { literal: value.val }
    const result: Record<string, any> = {}
    ;[...Object.getOwnPropertySymbols(value), ...Object.keys(value)].forEach((key) => {
      const label = typeof key === 'symbol' ? key.toString() : key
      result[label] = serializeWhereForAssertions((value as any)[key])
    })
    return result
  }
  return value
}

describe('Route-flagged canonical rule: SQL encodes every spec scenario', () => {
  let repository: ServiceHistoryRepository

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByIds.mockResolvedValue([])
    repository = new ServiceHistoryRepository()
  })

  it('aggregateRouteIntegrity() builds a flagged-count FILTER on the canonical rule text', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    const allSql = [
      ...collectLiteralStrings(callArg.attributes),
      ...collectLiteralStrings(callArg.where),
    ].join(' | ')

    // Scenario: administratively terminated service (no start_trip_at) is excluded
    expect(allSql).toContain(`metadata->>'start_trip_at' IS NOT NULL`)
    // Scenario: suppressed-GPS trip (empty/missing/`{}` route) is flagged
    expect(allSql).toContain(`metadata->>'route' IS NULL`)
    expect(allSql).toContain(`metadata->>'route' = ''`)
    expect(allSql).toContain(`metadata->>'route' = '{}'`)
    // Scenario: zero-distance trip is flagged; guarded so non-numeric values
    // never abort the query
    expect(allSql).toContain('<= 0')
    expect(allSql).toContain(`~ '^-?[0-9]+(\\.[0-9]+)?$'`)
    expect(allSql).toContain('ELSE 0')
    // Only terminated services are ever counted
    expect(allSql).toContain(`status = 'terminated'`)
  })

  it('the guarded numeric regex matches real numbers and rejects non-numeric text without throwing', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    const allSql = [
      ...collectLiteralStrings(callArg.attributes),
      ...collectLiteralStrings(callArg.where),
    ].join(' | ')

    const match = allSql.match(/~ '([^']+)'/)
    expect(match).not.toBeNull()
    const guardRegex = new RegExp((match as RegExpMatchArray)[1])

    // Non-numeric trip_distance: the regex does not match, so the CASE falls
    // through to `ELSE 0` (<= 0 -> flagged) instead of throwing/aborting.
    expect(guardRegex.test('not-a-number')).toBe(false)
    expect(guardRegex.test('')).toBe(false)
    // Real numeric values (positive, zero, decimal, negative) are matched
    // and cast for the <= 0 comparison.
    expect(guardRegex.test('12.5')).toBe(true)
    expect(guardRegex.test('0')).toBe(true)
    expect(guardRegex.test('-3')).toBe(true)
  })

  it('listPage({ routeIntegrity: "flagged" }) filters on the same canonical rule text as the aggregation', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.listPage({ routeIntegrity: 'flagged' })

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    const allSql = collectLiteralStrings(callArg.where).join(' | ')

    expect(allSql).toContain(`metadata->>'start_trip_at' IS NOT NULL`)
    expect(allSql).toContain(`metadata->>'route' = '{}'`)
    expect(allSql).toContain('<= 0')
  })

  it('listPage() without routeIntegrity leaves the where clause unchanged (history behavior preserved)', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.listPage({})

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    expect(callArg.where).toEqual({})
  })
})

describe('aggregateRouteIntegrity(): row mapping, ranking, and ratio format', () => {
  let repository: ServiceHistoryRepository

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByIds.mockResolvedValue([])
    repository = new ServiceHistoryRepository()
  })

  it('requests results grouped by driver_id and ordered by flagged_trips DESC', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    expect(callArg.group).toEqual(['driver_id'])
    expect(callArg.order).toEqual([expect.objectContaining({ val: '"flagged_trips" DESC' })])
  })

  it('preserves the DB-provided ranking order in the mapped output', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([
      { driver_id: 'drv-a', total_trips: '10', flagged_trips: '7' },
      { driver_id: 'drv-b', total_trips: '20', flagged_trips: '2' },
    ])

    const result = await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    expect(result.map((row) => row.driver_id)).toEqual(['drv-a', 'drv-b'])
    expect(result[0]).toEqual({
      driver_id: 'drv-a',
      total_trips: 10,
      flagged_trips: 7,
      flagged_ratio: 0.7,
    })
    expect(result[1]).toEqual({
      driver_id: 'drv-b',
      total_trips: 20,
      flagged_trips: 2,
      flagged_ratio: 0.1,
    })
  })

  it('flagged_ratio is a [0,1] float, not a 0-100 percentage', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([
      { driver_id: 'drv-a', total_trips: '4', flagged_trips: '1' },
    ])

    const [row] = await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    expect(row.flagged_ratio).toBeCloseTo(0.25)
    expect(row.flagged_ratio).toBeGreaterThanOrEqual(0)
    expect(row.flagged_ratio).toBeLessThanOrEqual(1)
  })

  it('defaults flagged_ratio to 0 instead of dividing by zero when total_trips is 0', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([
      { driver_id: 'drv-a', total_trips: '0', flagged_trips: '0' },
    ])

    const [row] = await repository.aggregateRouteIntegrity({ from: 1, to: 2 })

    expect(row.flagged_ratio).toBe(0)
  })

  it('narrows the query to a single driver when driverId is provided', async () => {
    ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValue([])

    await repository.aggregateRouteIntegrity({ from: 1, to: 2, driverId: 'drv-1' })

    const callArg = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
    const conditionsString = JSON.stringify(serializeWhereForAssertions(callArg.where))

    expect(conditionsString).toContain('"driver_id":"drv-1"')
  })
})
