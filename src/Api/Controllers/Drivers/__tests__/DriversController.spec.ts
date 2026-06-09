import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'

// --- Module mocks (hoisted) ---

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  init: jest.fn(),
  Handlers: {
    requestHandler: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    tracingHandler: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    errorHandler: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  },
}))

jest.mock('@sentry/tracing', () => ({
  Integrations: { Express: jest.fn() },
}))

jest.mock('../../../../Middlewares/Authorization', () => ({
  requireAuth: jest.fn((_req: any, _res: any, next: any) => next()),
}))

// Store is instantiated at module-level in DriversController; provide a stub
// so the module can be loaded without touching Firebase or Redis.
const mockRefreshDrivers = jest.fn().mockResolvedValue(undefined)
jest.mock('../../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      refreshDrivers: mockRefreshDrivers,
    })),
  },
}))

// DriverRepository uses Firebase RTDB — mock the whole module.
jest.mock('../../../../Repositories/DriverRepository', () => ({
  __esModule: true,
  default: {
    removeDriver: jest.fn().mockResolvedValue(undefined),
    seedConnectedDrivers: jest.fn(),
    watchConnectedDrivers: jest.fn(),
  },
}))

// FCM uses Firebase Admin SDK — mock sendNotificationTo.
jest.mock('../../../../Services/firebase/FCM', () => ({
  __esModule: true,
  default: {
    sendNotificationTo: jest.fn().mockResolvedValue(undefined),
    sendDifusionNotification: jest.fn().mockResolvedValue(undefined),
  },
}))

// ---------------------------------------------------------------------------
// Typed accessors for mocked modules
// ---------------------------------------------------------------------------

const MockedAuth = jest.requireMock('../../../../Middlewares/Authorization') as {
  requireAuth: jest.Mock
}

const MockedDriverRepository = jest.requireMock('../../../../Repositories/DriverRepository') as {
  default: { removeDriver: jest.Mock }
}

const MockedFCM = jest.requireMock('../../../../Services/firebase/FCM') as {
  default: { sendNotificationTo: jest.Mock }
}

// ---------------------------------------------------------------------------
// HTTP helpers (same shape as ServiceHistoryController.spec.ts)
// ---------------------------------------------------------------------------

function get(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers,
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data })
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function post(
  server: http.Server,
  path: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo
    const payload = JSON.stringify(body)
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data })
        }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const VALID_AUTH_HEADERS = {
  authorization: 'Bearer test-api-key',
  'x-client-platform': 'admin',
  'x-client-version': '2.0.0',
}

// ---------------------------------------------------------------------------
// Server setup + Container spy
// ---------------------------------------------------------------------------

let server: http.Server
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Container = require('../../../../Container/Container').default
const mockList = jest.fn()
const mockIndex = jest.fn()
const mockBulkSetEnabled = jest.fn()
const mockFindByDriverId = jest.fn()

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controller = require('../DriversController').default
  const app = express()
  app.use(express.json())
  app.use('/drivers', controller)
  server = http.createServer(app)
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockReset()
  mockIndex.mockReset()
  mockBulkSetEnabled.mockReset()
  mockFindByDriverId.mockReset()
  mockRefreshDrivers.mockReset()
  mockRefreshDrivers.mockResolvedValue(undefined)
  MockedDriverRepository.default.removeDriver.mockReset()
  MockedDriverRepository.default.removeDriver.mockResolvedValue(undefined)
  MockedFCM.default.sendNotificationTo.mockReset()
  MockedFCM.default.sendNotificationTo.mockResolvedValue(undefined)
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  jest.spyOn(Container, 'getDriverRecordRepository').mockReturnValue({
    list: mockList,
    index: mockIndex,
    bulkSetEnabled: mockBulkSetEnabled,
  })
  jest.spyOn(Container, 'getDriverTokenRecordRepository').mockReturnValue({
    findByDriverId: mockFindByDriverId,
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /drivers (DriversController)', () => {
  // --- perPage validation (controller-level) ---

  describe('400: invalid perPage value', () => {
    it('returns 400 when perPage is 10 (not in allowed set)', async () => {
      const { status, body } = await get(server, '/drivers?perPage=10', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/perPage/i)
      expect(mockList).not.toHaveBeenCalled()
    })

    it('returns 400 when perPage is 100 (too large)', async () => {
      const { status, body } = await get(server, '/drivers?perPage=100', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
    })

    it('returns 400 when perPage is 0', async () => {
      const { status, body } = await get(server, '/drivers?perPage=0', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
    })

    it('returns 400 when perPage is a string (non-numeric)', async () => {
      const { status, body } = await get(server, '/drivers?perPage=many', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
    })
  })

  describe('200: valid perPage values are accepted', () => {
    it('returns 200 when perPage=20', async () => {
      mockList.mockResolvedValue({ rows: [], total: 0 })

      const { status, body } = await get(server, '/drivers?perPage=20', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns 200 when perPage=30', async () => {
      mockList.mockResolvedValue({ rows: [], total: 0 })

      const { status, body } = await get(server, '/drivers?perPage=30', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns 200 when perPage=50', async () => {
      mockList.mockResolvedValue({ rows: [], total: 0 })

      const { status, body } = await get(server, '/drivers?perPage=50', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
    })
  })

  // --- sort whitelist rejection at controller level ---

  describe('400: invalid sort field', () => {
    it('returns 400 when sort is not in whitelist', async () => {
      mockList.mockRejectedValue(
        new Error(
          'Invalid sort field: "invalid_field". Allowed: name, created_at, last_connection, balance'
        )
      )

      const { status, body } = await get(server, '/drivers?sort=invalid_field', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/Invalid sort field/)
    })
  })

  // --- fallback to index() when no listed params ---

  describe('200: no listed params falls back to index()', () => {
    it('calls index() and returns { drivers, total } when no filter/sort/page params are present', async () => {
      mockIndex.mockResolvedValue([{ id: 'drv-1' }])

      const { status, body } = await get(server, '/drivers', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.drivers).toHaveLength(1)
      expect(body.total).toBe(1)
      expect(mockList).not.toHaveBeenCalled()
    })
  })

  // --- list() called with search param ---

  describe('200: list() is called when listed params are present', () => {
    it('calls list() and returns { success, data: { drivers, total } } when search param is passed', async () => {
      mockList.mockResolvedValue({ rows: [{ id: 'drv-2' }], total: 1 })

      const { status, body } = await get(server, '/drivers?search=john', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.drivers).toHaveLength(1)
      expect(body.data.total).toBe(1)
      expect(mockList).toHaveBeenCalledTimes(1)
    })

    it('returns empty drivers array with correct total when overshoot page yields 0 rows', async () => {
      mockList.mockResolvedValue({ rows: [], total: 5 })

      const { status, body } = await get(server, '/drivers?page=100&perPage=30', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.drivers).toEqual([])
      expect(body.data.total).toBe(5)
    })
  })

  // --- default perPage passed to list() ---

  describe('default perPage forwarding', () => {
    it('forwards perPage=undefined to list() when perPage param is omitted (uses repository default 30)', async () => {
      mockList.mockResolvedValue({ rows: [], total: 0 })

      await get(server, '/drivers?search=x', VALID_AUTH_HEADERS)

      const callArg = (mockList as jest.Mock).mock.calls[0][0]
      // perPage is undefined when omitted in the query — repository defaults to 30
      expect(callArg.perPage).toBeUndefined()
    })
  })

  // --- Unauthorized ---

  describe('401: unauthenticated requests are rejected', () => {
    it('returns 401 when requireAuth rejects the request', async () => {
      MockedAuth.requireAuth.mockImplementation((_req: any, res: any) => {
        res.status(401).json({ success: false, message: 'Unauthorized', data: {} })
      })

      const { status, body } = await get(server, '/drivers?search=x')

      expect(status).toBe(401)
      expect(body.success).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/bulk/enable
// ---------------------------------------------------------------------------

describe('POST /drivers/bulk/enable (DriversController)', () => {
  describe('400: invalid driverIds', () => {
    it('returns 400 when driverIds is missing', async () => {
      const { status, body } = await post(server, '/drivers/bulk/enable', {}, VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(mockBulkSetEnabled).not.toHaveBeenCalled()
    })

    it('returns 400 when driverIds is an empty array', async () => {
      const { status, body } = await post(
        server,
        '/drivers/bulk/enable',
        { driverIds: [] },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(mockBulkSetEnabled).not.toHaveBeenCalled()
    })

    it('returns 400 when driverIds is not an array', async () => {
      const { status, body } = await post(
        server,
        '/drivers/bulk/enable',
        { driverIds: 'drv-1' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockBulkSetEnabled).not.toHaveBeenCalled()
    })
  })

  describe('200: bulk enable succeeds', () => {
    it('calls bulkSetEnabled and returns success result', async () => {
      mockBulkSetEnabled.mockResolvedValue({ processed: 2, failed: [] })

      const { status, body } = await post(
        server,
        '/drivers/bulk/enable',
        { driverIds: ['drv-1', 'drv-2'] },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.processed).toBe(2)
      expect(body.data.failed).toEqual([])
      expect(mockBulkSetEnabled).toHaveBeenCalledTimes(1)
    })

    it('calls Store.refreshDrivers() exactly once after bulk enable', async () => {
      mockBulkSetEnabled.mockResolvedValue({ processed: 2, failed: [] })

      await post(
        server,
        '/drivers/bulk/enable',
        { driverIds: ['drv-1', 'drv-2'] },
        VALID_AUTH_HEADERS
      )

      expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
    })
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/bulk/disable
// ---------------------------------------------------------------------------

describe('POST /drivers/bulk/disable (DriversController)', () => {
  describe('400: invalid driverIds', () => {
    it('returns 400 when driverIds is missing', async () => {
      const { status, body } = await post(server, '/drivers/bulk/disable', {}, VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(mockBulkSetEnabled).not.toHaveBeenCalled()
    })

    it('returns 400 when driverIds is an empty array', async () => {
      const { status, body } = await post(
        server,
        '/drivers/bulk/disable',
        { driverIds: [] },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(mockBulkSetEnabled).not.toHaveBeenCalled()
    })
  })

  describe('200: bulk disable succeeds', () => {
    it('calls bulkSetEnabled and returns success result', async () => {
      mockBulkSetEnabled.mockResolvedValue({ processed: 2, failed: [] })

      const { status, body } = await post(
        server,
        '/drivers/bulk/disable',
        { driverIds: ['drv-1', 'drv-2'] },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockBulkSetEnabled).toHaveBeenCalledTimes(1)
    })

    it('calls DriverRepository.removeDriver() for each driver in the RTDB index', async () => {
      mockBulkSetEnabled.mockResolvedValue({ processed: 2, failed: [] })

      await post(
        server,
        '/drivers/bulk/disable',
        { driverIds: ['drv-1', 'drv-2'] },
        VALID_AUTH_HEADERS
      )

      expect(MockedDriverRepository.default.removeDriver).toHaveBeenCalledTimes(2)
      expect(MockedDriverRepository.default.removeDriver).toHaveBeenCalledWith('drv-1')
      expect(MockedDriverRepository.default.removeDriver).toHaveBeenCalledWith('drv-2')
    })

    it('calls Store.refreshDrivers() exactly once after bulk disable', async () => {
      mockBulkSetEnabled.mockResolvedValue({ processed: 2, failed: [] })

      await post(
        server,
        '/drivers/bulk/disable',
        { driverIds: ['drv-1', 'drv-2'] },
        VALID_AUTH_HEADERS
      )

      expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
    })
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/bulk/send-message
// ---------------------------------------------------------------------------

describe('POST /drivers/bulk/send-message (DriversController)', () => {
  describe('400: invalid driverIds', () => {
    it('returns 400 when driverIds is missing', async () => {
      const { status, body } = await post(
        server,
        '/drivers/bulk/send-message',
        { title: 'Hi', body: 'Hello' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(MockedFCM.default.sendNotificationTo).not.toHaveBeenCalled()
    })

    it('returns 400 when driverIds is an empty array', async () => {
      const { status, body } = await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: [], title: 'Hi', body: 'Hello' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/driverIds/i)
      expect(MockedFCM.default.sendNotificationTo).not.toHaveBeenCalled()
    })
  })

  describe('200: bulk send-message succeeds', () => {
    it('sends FCM notification to each driver that has a token', async () => {
      mockFindByDriverId
        .mockResolvedValueOnce({ token: 'token-drv-1' })
        .mockResolvedValueOnce({ token: 'token-drv-2' })

      const { status, body } = await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: ['drv-1', 'drv-2'], title: 'Hello', body: 'World' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.processed).toEqual(expect.arrayContaining(['drv-1', 'drv-2']))
      expect(body.data.failed).toHaveLength(0)
      expect(MockedFCM.default.sendNotificationTo).toHaveBeenCalledTimes(2)
    })

    it('does NOT call Store.refreshDrivers() after bulk send-message', async () => {
      mockFindByDriverId.mockResolvedValue({ token: 'token-drv-1' })

      await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: ['drv-1'], title: 'Hi', body: 'Hey' },
        VALID_AUTH_HEADERS
      )

      expect(mockRefreshDrivers).not.toHaveBeenCalled()
    })

    it('forwards data.duration in the FCM payload', async () => {
      mockFindByDriverId.mockResolvedValue({ token: 'token-drv-1' })

      await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: ['drv-1'], title: 'Shift', body: 'Long shift', data: { duration: '480' } },
        VALID_AUTH_HEADERS
      )

      expect(MockedFCM.default.sendNotificationTo).toHaveBeenCalledTimes(1)
      const [, payload] = MockedFCM.default.sendNotificationTo.mock.calls[0]
      expect(payload.data.duration).toBe('480')
    })

    it('records driver in failed list when no FCM token exists, and still processes other drivers', async () => {
      // drv-1 has no token; drv-2 has a token
      mockFindByDriverId.mockResolvedValueOnce(null).mockResolvedValueOnce({ token: 'token-drv-2' })

      const { status, body } = await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: ['drv-1', 'drv-2'], title: 'Test', body: 'Test' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.data.failed).toHaveLength(1)
      expect(body.data.failed[0].id).toBe('drv-1')
      expect(body.data.processed).toContain('drv-2')
      // drv-2 still gets its notification even though drv-1 failed
      expect(MockedFCM.default.sendNotificationTo).toHaveBeenCalledTimes(1)
    })

    it('records driver in failed list when FCM send throws, and still processes other drivers', async () => {
      mockFindByDriverId.mockResolvedValue({ token: 'some-token' })
      // drv-1 FCM throws; drv-2 FCM succeeds
      MockedFCM.default.sendNotificationTo
        .mockRejectedValueOnce(new Error('FCM unreachable'))
        .mockResolvedValueOnce(undefined)

      const { status, body } = await post(
        server,
        '/drivers/bulk/send-message',
        { driverIds: ['drv-1', 'drv-2'], title: 'Test', body: 'Test' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.data.failed).toHaveLength(1)
      expect(body.data.failed[0].id).toBe('drv-1')
      expect(body.data.failed[0].reason).toMatch(/FCM unreachable/)
      expect(body.data.processed).toContain('drv-2')
    })
  })
})
