import { Op } from 'sequelize'
import ServiceHistoryMigrationService from '../ServiceHistoryMigrationService'
import ServiceHistoryRecord from '../../../Models/ServiceHistoryRecord'
import Service from '../../../Models/Service'
import { ServiceInterface } from '../../../Interfaces/ServiceInterface'

jest.mock('../../../Models/ServiceHistoryRecord', () => ({
  upsert: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
}))

const mockMetricsUpsert = jest.fn().mockResolvedValue(undefined)
const mockMetricsDelete = jest.fn().mockResolvedValue(undefined)
const mockMetricsRebuildAll = jest.fn().mockResolvedValue(0)

jest.mock('../../../Repositories/ServiceMetricsDailyRepository', () => {
  return jest.fn().mockImplementation(() => ({
    upsert: mockMetricsUpsert,
    delete: mockMetricsDelete,
    rebuildAll: mockMetricsRebuildAll,
  }))
})

jest.mock('../../../Repositories/ServiceRepository', () => ({
  findServiceById: jest.fn(),
}))

function buildMinimalService(overrides: Partial<ServiceInterface> = {}): ServiceInterface {
  return {
    id: 'svc-test-1',
    status: 'terminated',
    start_loc: {
      id: 'p1',
      name: 'Place',
      lat: 2.44,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    },
    end_loc: null,
    phone: '+573001234567',
    name: 'Test User',
    comment: null,
    amount: null,
    metadata: {},
    driver_id: null,
    client_id: '573001234567',
    wp_client_id: null,
    created_at: 1735700000,
    created_by: null,
    assigned_by: null,
    canceled_by: null,
    terminated_by: null,
    ...overrides,
  }
}

describe('ServiceHistoryMigrationService.upsertHistoryRecord', () => {
  let service: ServiceHistoryMigrationService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ServiceHistoryMigrationService()
  })

  describe('Case B: normalizes polluted client_id', () => {
    it('calls ServiceHistoryRecord.upsert with client_id stripped of @c.us suffix', async () => {
      ;(ServiceHistoryRecord.upsert as jest.Mock).mockResolvedValue([{}, true])

      const input = buildMinimalService({ client_id: '573001234567@c.us' })

      await service.upsertHistoryRecord(input)

      expect(ServiceHistoryRecord.upsert).toHaveBeenCalledTimes(1)

      const capturedArg = (ServiceHistoryRecord.upsert as jest.Mock).mock.calls[0][0]
      expect(capturedArg.client_id).toBe('573001234567')
    })
  })

  describe('Case C: throws on invalid client_id', () => {
    it('throws and does NOT call ServiceHistoryRecord.upsert when client_id is "abc"', async () => {
      const input = buildMinimalService({ client_id: 'abc' })

      await expect(service.upsertHistoryRecord(input)).rejects.toThrow()

      expect(ServiceHistoryRecord.upsert).not.toHaveBeenCalled()
    })
  })

  describe('Case D: strips RTDB-only field client_completed_services_count', () => {
    it('does NOT include client_completed_services_count in the SQL insert payload', async () => {
      ;(ServiceHistoryRecord.upsert as jest.Mock).mockResolvedValue([{}, true])

      const input = buildMinimalService({ client_completed_services_count: 12 })

      await service.upsertHistoryRecord(input)

      expect(ServiceHistoryRecord.upsert).toHaveBeenCalledTimes(1)

      const capturedArg = (ServiceHistoryRecord.upsert as jest.Mock).mock.calls[0][0]
      expect(capturedArg).not.toHaveProperty('client_completed_services_count')
    })
  })

  describe('Case E: captures the driver deduction from metadata.discount', () => {
    it('sets deducted_value to metadata.discount when present', async () => {
      ;(ServiceHistoryRecord.upsert as jest.Mock).mockResolvedValue([{}, true])

      const input = buildMinimalService({ metadata: { discount: 2000 } })

      await service.upsertHistoryRecord(input)

      expect(ServiceHistoryRecord.upsert).toHaveBeenCalledTimes(1)

      const capturedArg = (ServiceHistoryRecord.upsert as jest.Mock).mock.calls[0][0]
      expect(capturedArg.deducted_value).toBe(2000)
    })

    it('defaults deducted_value to 0 when metadata.discount is absent', async () => {
      ;(ServiceHistoryRecord.upsert as jest.Mock).mockResolvedValue([{}, true])

      const input = buildMinimalService({ metadata: {} })

      await service.upsertHistoryRecord(input)

      expect(ServiceHistoryRecord.upsert).toHaveBeenCalledTimes(1)

      const capturedArg = (ServiceHistoryRecord.upsert as jest.Mock).mock.calls[0][0]
      expect(capturedArg.deducted_value).toBe(0)
    })
  })
})

describe('ServiceHistoryMigrationService.rebuildMetricsForDate', () => {
  let service: ServiceHistoryMigrationService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ServiceHistoryMigrationService()
  })

  describe('Case F: excludes origin=test rows from count and commission_sum', () => {
    it('counts only real rows and sums commission excluding the test row', async () => {
      ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValueOnce([
        { status: Service.STATUS_TERMINATED, deducted_value: 1000 },
        { status: Service.STATUS_TERMINATED, deducted_value: 500 },
      ])

      await service.rebuildMetricsForDate('2026-01-15')

      expect(mockMetricsUpsert).toHaveBeenCalledWith({
        date: '2026-01-15',
        status: Service.STATUS_TERMINATED,
        count: 2,
        commission_sum: 1500,
      })
    })

    it('builds a NULL-safe origin exclusion filter that excludes "test" but keeps NULL origin', async () => {
      ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValueOnce([])

      await service.rebuildMetricsForDate('2026-01-15')

      const callArgs = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
      const originClause = callArgs.where.origin

      expect(originClause[Op.or]).toEqual([{ [Op.ne]: Service.ORIGIN_TEST }, { [Op.is]: null }])
    })
  })

  describe('Case G: a day whose only terminated rows are test-origin keeps no rollup row', () => {
    it('deletes the terminated rollup row instead of upserting it', async () => {
      ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValueOnce([])

      await service.rebuildMetricsForDate('2026-01-16')

      expect(mockMetricsDelete).toHaveBeenCalledWith('2026-01-16', Service.STATUS_TERMINATED)
      expect(mockMetricsUpsert).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: Service.STATUS_TERMINATED })
      )
    })
  })
})

describe('ServiceHistoryMigrationService.rebuildAllMetrics', () => {
  let service: ServiceHistoryMigrationService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ServiceHistoryMigrationService()
  })

  describe('Case H: builds the same NULL-safe origin exclusion filter as rebuildMetricsForDate', () => {
    it('excludes origin="test" but keeps NULL origin rows in the backfill query', async () => {
      ;(ServiceHistoryRecord.findAll as jest.Mock).mockResolvedValueOnce([])

      await service.rebuildAllMetrics()

      const callArgs = (ServiceHistoryRecord.findAll as jest.Mock).mock.calls[0][0]
      const originClause = callArgs.where.origin

      expect(originClause[Op.or]).toEqual([{ [Op.ne]: Service.ORIGIN_TEST }, { [Op.is]: null }])
    })
  })
})
