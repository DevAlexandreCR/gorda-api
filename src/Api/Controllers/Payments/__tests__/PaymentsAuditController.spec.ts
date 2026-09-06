import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'

// --- Module mocks (hoisted) ---

jest.mock('../../../../Middlewares/Authorization', () => ({
  requireAuth: jest.fn((_req: any, _res: any, next: any) => next()),
}))

const MockedAuth = jest.requireMock('../../../../Middlewares/Authorization') as {
  requireAuth: jest.Mock
}

// ---------------------------------------------------------------------------
// HTTP helper
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
const mockListMonthly = jest.fn()
const mockSummaryMonthly = jest.fn()
const mockListRecharges = jest.fn()
const mockSummaryRecharges = jest.fn()
const mockListActors = jest.fn()

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controllerModule = require('../PaymentsAuditController')
  const app = express()
  app.use(express.json())
  app.use('/payments', controllerModule.default)
  server = http.createServer(app)
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

beforeEach(() => {
  jest.clearAllMocks()
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  mockListMonthly.mockReset()
  mockSummaryMonthly.mockReset()
  mockListRecharges.mockReset()
  mockSummaryRecharges.mockReset()
  mockListActors.mockReset()
  jest.spyOn(Container, 'getPaymentsAuditRepository').mockReturnValue({
    listMonthly: mockListMonthly,
    summaryMonthly: mockSummaryMonthly,
    listRecharges: mockListRecharges,
    summaryRecharges: mockSummaryRecharges,
    listActors: mockListActors,
  } as any)
})

afterEach(() => {
  jest.restoreAllMocks()
})

const EMPTY_RESULT = {
  rows: [],
  total: 0,
  totals: { activeAmount: 0, activeCount: 0, voidedCount: 0, activeDriverCount: 0 },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /payments/monthly (PaymentsAuditController)', () => {
  describe('400: invalid parameters are rejected and no query runs', () => {
    it('returns 400 when perPage=7 (not in allowed set)', async () => {
      const { status, body } = await get(server, '/payments/monthly?perPage=7', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.data).toEqual({})
      expect(mockListMonthly).not.toHaveBeenCalled()
    })

    it('returns 400 when period=2026-13 (invalid month)', async () => {
      const { status, body } = await get(
        server,
        '/payments/monthly?period=2026-13',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/period/i)
      expect(mockListMonthly).not.toHaveBeenCalled()
    })

    it('returns 400 when anomaly=bogus (not in whitelist)', async () => {
      const { status, body } = await get(
        server,
        '/payments/monthly?anomaly=bogus',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/anomaly/i)
      expect(mockListMonthly).not.toHaveBeenCalled()
    })

    it('returns 400 when createdFrom is later than createdTo', async () => {
      const { status, body } = await get(
        server,
        '/payments/monthly?createdFrom=2026-08-20&createdTo=2026-08-01',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/createdFrom/i)
      expect(mockListMonthly).not.toHaveBeenCalled()
    })
  })

  describe('defaults forwarded to the repository', () => {
    it('defaults perPage to 50 and sort to -created_at when omitted', async () => {
      mockListMonthly.mockResolvedValue(EMPTY_RESULT)

      const { status, body } = await get(server, '/payments/monthly?period=2026-08', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockListMonthly).toHaveBeenCalledTimes(1)
      const callArg = mockListMonthly.mock.calls[0][0]
      expect(callArg.perPage).toBe(50)
      expect(callArg.sort).toBe('-created_at')
      expect(callArg.page).toBe(1)
    })
  })

  describe('200: envelope shape', () => {
    it('returns { rows, total, totals } exactly as produced by the repository', async () => {
      const result = {
        rows: [{ id: 'p1', period: '2026-08', amount: 90000 }],
        total: 1,
        totals: { activeAmount: 90000, activeCount: 1, voidedCount: 0, activeDriverCount: 1 },
      }
      mockListMonthly.mockResolvedValue(result)

      const { status, body } = await get(server, '/payments/monthly?period=2026-08', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual(result)
    })
  })
})

describe('GET /payments/recharges (PaymentsAuditController)', () => {
  describe('400: monthly-only parameters are rejected', () => {
    it('returns 400 when anomaly=voided (monthly-only anomaly value)', async () => {
      const { status, body } = await get(
        server,
        '/payments/recharges?anomaly=voided',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockListRecharges).not.toHaveBeenCalled()
    })

    it('returns 400 when status is present', async () => {
      const { status, body } = await get(
        server,
        '/payments/recharges?status=active',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/status/i)
      expect(mockListRecharges).not.toHaveBeenCalled()
    })

    it('returns 400 when amountThreshold is present', async () => {
      const { status, body } = await get(
        server,
        '/payments/recharges?amountThreshold=1000',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/amountThreshold/i)
      expect(mockListRecharges).not.toHaveBeenCalled()
    })
  })

  describe('defaults forwarded to the repository', () => {
    it('defaults perPage to 50 and sort to -created_at when omitted', async () => {
      mockListRecharges.mockResolvedValue(EMPTY_RESULT)

      const { status, body } = await get(
        server,
        '/payments/recharges?period=2026-08',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockListRecharges).toHaveBeenCalledTimes(1)
      const callArg = mockListRecharges.mock.calls[0][0]
      expect(callArg.perPage).toBe(50)
      expect(callArg.sort).toBe('-created_at')
    })
  })

  describe('200: envelope shape', () => {
    it('returns { rows, total, totals } exactly as produced by the repository', async () => {
      const result = {
        rows: [{ id: 'r1', amount: 20000, balanceBefore: 0, balanceAfter: 20000 }],
        total: 1,
        totals: { activeAmount: 20000, activeCount: 1, voidedCount: 0, activeDriverCount: 1 },
      }
      mockListRecharges.mockResolvedValue(result)

      const { status, body } = await get(
        server,
        '/payments/recharges?period=2026-08',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual(result)
    })
  })
})

describe('GET /payments/actors (PaymentsAuditController)', () => {
  describe('400: missing or invalid type', () => {
    it('returns 400 when type is missing', async () => {
      const { status, body } = await get(server, '/payments/actors', VALID_AUTH_HEADERS)

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/type/i)
      expect(mockListActors).not.toHaveBeenCalled()
    })

    it('returns 400 when type is not "monthly" or "recharges"', async () => {
      const { status, body } = await get(
        server,
        '/payments/actors?type=other',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockListActors).not.toHaveBeenCalled()
    })
  })

  describe('200: envelope shape', () => {
    it('returns { actors } exactly as produced by the repository', async () => {
      mockListActors.mockResolvedValue([{ uid: 'u1', name: 'Ana' }])

      const { status, body } = await get(
        server,
        '/payments/actors?type=monthly',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual({ actors: [{ uid: 'u1', name: 'Ana' }] })
      expect(mockListActors).toHaveBeenCalledWith('monthly')
    })
  })
})

describe('401: unauthenticated requests are rejected (PaymentsAuditController)', () => {
  it('returns 401 when requireAuth rejects the request', async () => {
    MockedAuth.requireAuth.mockImplementation((_req: any, res: any) => {
      res.status(401).json({ success: false, message: 'Unauthorized', data: {} })
    })

    const { status, body } = await get(server, '/payments/monthly')

    expect(status).toBe(401)
    expect(body.success).toBe(false)
    expect(mockListMonthly).not.toHaveBeenCalled()
  })
})
