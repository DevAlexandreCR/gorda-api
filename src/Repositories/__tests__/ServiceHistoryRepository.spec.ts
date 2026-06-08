import ServiceHistoryRepository from '../ServiceHistoryRepository'
import ServiceHistoryRecord from '../../Models/ServiceHistoryRecord'

jest.mock('../../Models/ServiceHistoryRecord', () => ({
  findAll: jest.fn(),
  count: jest.fn(),
}))

describe('ServiceHistoryRepository filter normalization', () => {
  let repository: ServiceHistoryRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new ServiceHistoryRepository()
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
