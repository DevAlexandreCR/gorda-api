import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'

// --- Module mocks ---
// All jest.mock calls are hoisted. Do NOT reference outer variables in factories.
// Mirrors the pattern already used in ServiceHistoryController.spec.ts.

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

const MockedAuth = jest.requireMock('../../../../Middlewares/Authorization') as {
  requireAuth: jest.Mock
}

// --- HTTP helper ---

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

const VALID_AUTH_HEADERS = {
  authorization: 'Bearer test-api-key',
  'x-client-platform': 'admin',
  'x-client-version': '2.0.0',
}

// --- Server setup + Container spy ---
// Container is NOT mocked at the module level. We spy on
// Container.getServiceHistoryRepository so each test controls exactly what the
// repository returns.

let server: http.Server
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Container = require('../../../../Container/Container').default
const mockAggregateRouteIntegrity = jest.fn()
const mockListPage = jest.fn()
const mockCount = jest.fn()

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controller = require('../ServiceHistoryController').default
  const app = express()
  app.use(express.json())
  app.use('/services', controller)
  server = http.createServer(app)
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

beforeEach(() => {
  jest.clearAllMocks()
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  jest.spyOn(Container, 'getServiceHistoryRepository').mockReturnValue({
    aggregateRouteIntegrity: mockAggregateRouteIntegrity,
    listPage: mockListPage,
    count: mockCount,
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// --- Tests ---

describe('GET /services/route-integrity', () => {
  describe('400: missing or invalid numeric date range', () => {
    it('returns 400 and does not call the repository when from/to are absent', async () => {
      const { status, body } = await get(server, '/services/route-integrity', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockAggregateRouteIntegrity).not.toHaveBeenCalled()
    })

    it('returns 400 when from/to are non-numeric strings', async () => {
      const { status, body } = await get(
        server,
        '/services/route-integrity?from=abc&to=xyz',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockAggregateRouteIntegrity).not.toHaveBeenCalled()
    })
  })

  describe('200: ranked rows returned by the repository', () => {
    it('returns rows in the order provided by the repository (flagged_trips DESC)', async () => {
      const rows = [
        { driver_id: 'drv-a', total_trips: 10, flagged_trips: 7, flagged_ratio: 0.7 },
        { driver_id: 'drv-b', total_trips: 20, flagged_trips: 2, flagged_ratio: 0.1 },
      ]
      mockAggregateRouteIntegrity.mockResolvedValue(rows)

      const { status, body } = await get(
        server,
        '/services/route-integrity?from=1&to=2',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.rows).toEqual(rows)
      expect(body.data.rows[0].driver_id).toBe('drv-a')
      expect(body.data.rows[1].driver_id).toBe('drv-b')
      expect(mockAggregateRouteIntegrity).toHaveBeenCalledWith({ from: 1, to: 2, driverId: undefined })
    })

    it('threads an optional driverId through to the repository', async () => {
      mockAggregateRouteIntegrity.mockResolvedValue([])

      await get(server, '/services/route-integrity?from=1&to=2&driverId=drv-1', VALID_AUTH_HEADERS)

      expect(mockAggregateRouteIntegrity).toHaveBeenCalledWith({
        from: 1,
        to: 2,
        driverId: 'drv-1',
      })
    })

    it('flagged_ratio is returned as a [0,1] float, not a 0-100 percentage', async () => {
      mockAggregateRouteIntegrity.mockResolvedValue([
        { driver_id: 'drv-a', total_trips: 10, flagged_trips: 7, flagged_ratio: 0.7 },
      ])

      const { body } = await get(server, '/services/route-integrity?from=1&to=2', VALID_AUTH_HEADERS)

      const ratio = body.data.rows[0].flagged_ratio
      expect(typeof ratio).toBe('number')
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThanOrEqual(1)
      expect(ratio).toBe(0.7)
    })
  })

  describe('Unauthorized: unauthenticated requests are rejected like /history', () => {
    it('returns 401 when requireAuth rejects the request', async () => {
      MockedAuth.requireAuth.mockImplementation((_req: any, res: any) => {
        res.status(401).json({ success: false, message: 'Unauthorized', data: {} })
      })

      const { status, body } = await get(server, '/services/route-integrity?from=1&to=2')

      expect(status).toBe(401)
      expect(body.success).toBe(false)
      expect(mockAggregateRouteIntegrity).not.toHaveBeenCalled()
    })
  })
})

describe('GET /services/history — routeIntegrity filter combination', () => {
  it('threads routeIntegrity=flagged, driverId, and cursor pagination through to listPage', async () => {
    mockListPage.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await get(
      server,
      '/services/history?from=1&to=100&driverId=drv-1&routeIntegrity=flagged&perPage=5&direction=next&cursorCreated=50&cursorId=svc-9',
      VALID_AUTH_HEADERS
    )

    expect(mockListPage).toHaveBeenCalledTimes(1)
    const callArg = mockListPage.mock.calls[0][0]
    expect(callArg).toMatchObject({
      from: 1,
      to: 100,
      driverId: 'drv-1',
      routeIntegrity: 'flagged',
      perPage: 5,
      direction: 'next',
      cursorCreated: 50,
      cursorId: 'svc-9',
    })
  })

  it('leaves history behavior unaffected when routeIntegrity is absent (no filter forwarded)', async () => {
    mockListPage.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await get(server, '/services/history?from=1&to=100&driverId=drv-1', VALID_AUTH_HEADERS)

    const callArg = mockListPage.mock.calls[0][0]
    expect(callArg.routeIntegrity).toBeUndefined()
  })

  it('ignores an invalid routeIntegrity value instead of forwarding it', async () => {
    mockListPage.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await get(server, '/services/history?from=1&to=100&routeIntegrity=bogus', VALID_AUTH_HEADERS)

    const callArg = mockListPage.mock.calls[0][0]
    expect(callArg.routeIntegrity).toBeUndefined()
  })
})
