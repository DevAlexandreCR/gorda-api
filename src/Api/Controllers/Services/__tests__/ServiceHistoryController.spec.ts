import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'

// --- Module mocks ---
// All jest.mock calls are hoisted. Do NOT reference outer variables in factories.

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

// --- Typed accessors for mocked modules ---

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
// We import the controller after setting mocks. Container is NOT mocked at the
// module level here. Instead, we spy on Container.getServiceHistoryRepository
// using jest.spyOn so that we control what the repository returns per-test.

let server: http.Server
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Container = require('../../../../Container/Container').default
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
  mockCount.mockReset()
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  jest.spyOn(Container, 'getServiceHistoryRepository').mockReturnValue({ count: mockCount })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// --- Tests ---

describe('GET /services/clients/:clientId/completed-count', () => {
  describe('200: returns terminated-only count for canonical client id', () => {
    it('returns 200 with completedServicesCount when clientId is a plain digits string', async () => {
      mockCount.mockResolvedValue(7)

      const { status, body } = await get(
        server,
        '/services/clients/573001234567/completed-count',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.completedServicesCount).toBe(7)
    })
  })

  describe('200: accepts provider-suffixed input (@c.us)', () => {
    it('returns 200 when clientId is "573001234567@c.us" (stripped to canonical form)', async () => {
      mockCount.mockResolvedValue(3)

      const { status, body } = await get(
        server,
        '/services/clients/573001234567%40c.us/completed-count',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.completedServicesCount).toBe(3)
    })
  })

  describe('400: non-canonicalizable input', () => {
    it('returns 400 with success:false when clientId is "abc"', async () => {
      const { status, body } = await get(
        server,
        '/services/clients/abc/completed-count',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(typeof body.message).toBe('string')
      expect(body.message).toMatch(/toCanonicalClientId/)
    })
  })

  describe('500: repo throws unexpected error', () => {
    it('returns 500 with success:false when the repository throws', async () => {
      mockCount.mockRejectedValue(new Error('DB connection lost'))

      const { status, body } = await get(
        server,
        '/services/clients/573001234567/completed-count',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(500)
      expect(body.success).toBe(false)
    })
  })

  describe('200: clamps negative count to 0 and reports to Sentry', () => {
    it('returns 200 with completedServicesCount = 0 and calls Sentry when repo returns a negative value', async () => {
      mockCount.mockResolvedValue(-5)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require('@sentry/node')
      jest.spyOn(Sentry, 'captureException')

      const { status, body } = await get(
        server,
        '/services/clients/573001234567/completed-count',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.completedServicesCount).toBe(0)
      expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    })
  })

  describe('Unauthorized: unauthenticated requests are rejected', () => {
    it('returns 401 when requireAuth rejects the request', async () => {
      MockedAuth.requireAuth.mockImplementation((_req: any, res: any) => {
        res.status(401).json({ success: false, message: 'Unauthorized', data: {} })
      })

      const { status, body } = await get(
        server,
        '/services/clients/573001234567/completed-count'
        // no auth headers
      )

      expect(status).toBe(401)
      expect(body.success).toBe(false)
    })
  })
})
