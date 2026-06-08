import ServiceHistoryMigrationService from '../ServiceHistoryMigrationService'
import ServiceHistoryRecord from '../../../Models/ServiceHistoryRecord'
import { ServiceInterface } from '../../../Interfaces/ServiceInterface'

jest.mock('../../../Models/ServiceHistoryRecord', () => ({
  upsert: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
}))

jest.mock('../../../Repositories/ServiceMetricsDailyRepository', () => {
  return jest.fn().mockImplementation(() => ({
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    rebuildAll: jest.fn().mockResolvedValue(0),
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
})
