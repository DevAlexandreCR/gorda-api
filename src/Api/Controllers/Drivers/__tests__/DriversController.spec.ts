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

// DriverVehicleRepository — class instantiated at module-level in DriversController.
const mockDriverVehicleListForDriver = jest.fn()
const mockDriverVehicleLink = jest.fn()
const mockDriverVehicleSetSelectable = jest.fn()
const mockDriverVehicleFindEligibleForDriver = jest.fn()
const mockDriverVehicleFindMostRecentEligible = jest.fn()
jest.mock('../../../../Repositories/DriverVehicleRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    listForDriver: mockDriverVehicleListForDriver,
    link: mockDriverVehicleLink,
    setSelectable: mockDriverVehicleSetSelectable,
    findEligibleForDriver: mockDriverVehicleFindEligibleForDriver,
    findMostRecentEligible: mockDriverVehicleFindMostRecentEligible,
  })),
}))

// VehicleRepository — class instantiated at module-level in DriversController.
const mockFindOrCreateByPlate = jest.fn()
const mockVehicleRepoFindById = jest.fn()
jest.mock('../../../../Repositories/VehicleRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    findOrCreateByPlate: mockFindOrCreateByPlate,
    search: jest.fn(),
    findByNormalizedPlate: jest.fn(),
    findWithLinkedDrivers: jest.fn(),
    findById: mockVehicleRepoFindById,
    create: jest.fn(),
    update: jest.fn(),
    setEnabled: jest.fn(),
  })),
}))

// ActiveVehicleAssignmentRepository — singleton default export.
const mockActiveVehicleAssignmentFindByDriver = jest.fn()
jest.mock('../../../../Repositories/ActiveVehicleAssignmentRepository', () => ({
  __esModule: true,
  default: {
    findByDriver: mockActiveVehicleAssignmentFindByDriver,
    findByVehicle: jest.fn(),
    acquire: jest.fn(),
    releaseByDriver: jest.fn(),
    releaseByVehicle: jest.fn(),
  },
}))

// DriverRecord — Sequelize Model used directly in DriversController.
const mockDriverRecordFindByPk = jest.fn()
const mockDriverRecordUpdate = jest.fn()
jest.mock('../../../../Models/DriverRecord', () => ({
  __esModule: true,
  default: {
    findByPk: mockDriverRecordFindByPk,
    update: mockDriverRecordUpdate,
  },
  setupDriverAssociations: jest.fn(),
}))

// autoPromoteSelectedVehicle — used on selectable=false toggle.
const mockAutoPromoteSelectedVehicle = jest.fn()
jest.mock('../../../../Services/drivers/AutoPromoteVehicle', () => ({
  __esModule: true,
  autoPromoteSelectedVehicle: (...args: any[]) => mockAutoPromoteSelectedVehicle(...args),
}))

// ForceDisconnect service — mock so no Firebase calls occur in tests.
const mockForceDisconnect = jest.fn()
jest.mock('../../../../Services/drivers/ForceDisconnect', () => ({
  __esModule: true,
  forceDisconnect: (...args: any[]) => mockForceDisconnect(...args),
}))

// Database/sequelize — transaction() is spied on per-test in beforeEach.
// We do NOT mock the whole module here because Container.ts loads Models at
// module evaluation time; a stub Sequelize instance breaks Model.init().
const mockTransactionCommit = jest.fn().mockResolvedValue(undefined)
const mockTransactionRollback = jest.fn().mockResolvedValue(undefined)
const mockTransaction = { commit: mockTransactionCommit, rollback: mockTransactionRollback }

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

function patch(
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
      method: 'PATCH',
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

function put(
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
      method: 'PUT',
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
const mockFindById = jest.fn()
const mockStore = jest.fn()
const mockRechargeCreate = jest.fn()
const mockRechargeListForDriver = jest.fn()
const mockMonthlyPaymentSettingsGet = jest.fn()
const mockMonthlyPaymentSettingsUpsert = jest.fn()
const mockMonthlyPaymentCreate = jest.fn()
const mockMonthlyPaymentListForDriver = jest.fn()

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controllerModule = require('../DriversController')
  const app = express()
  app.use(express.json())
  app.use('/drivers', controllerModule.default)
  app.use('/public/drivers', controllerModule.PublicDriversController)
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
  mockFindById.mockReset()
  mockRefreshDrivers.mockReset()
  mockRefreshDrivers.mockResolvedValue(undefined)
  MockedDriverRepository.default.removeDriver.mockReset()
  MockedDriverRepository.default.removeDriver.mockResolvedValue(undefined)
  MockedFCM.default.sendNotificationTo.mockReset()
  MockedFCM.default.sendNotificationTo.mockResolvedValue(undefined)
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  // Reset vehicle-related mocks
  mockDriverVehicleListForDriver.mockReset()
  mockDriverVehicleLink.mockReset()
  mockDriverVehicleSetSelectable.mockReset()
  mockDriverVehicleFindEligibleForDriver.mockReset()
  mockDriverVehicleFindMostRecentEligible.mockReset()
  mockFindOrCreateByPlate.mockReset()
  mockActiveVehicleAssignmentFindByDriver.mockReset()
  mockDriverRecordFindByPk.mockReset()
  mockDriverRecordUpdate.mockReset()
  mockAutoPromoteSelectedVehicle.mockReset()
  mockForceDisconnect.mockReset()
  mockForceDisconnect.mockResolvedValue(undefined)
  mockTransactionCommit.mockReset()
  mockTransactionRollback.mockReset()
  mockTransactionCommit.mockResolvedValue(undefined)
  mockTransactionRollback.mockResolvedValue(undefined)
  // Spy on sequelize.transaction so POST /:id/vehicles can be tested without a real DB.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sequelizeInstance = require('../../../../Database/sequelize').default
  jest.spyOn(sequelizeInstance, 'transaction').mockResolvedValue(mockTransaction as any)
  mockStore.mockReset()
  mockVehicleRepoFindById.mockReset()
  jest.spyOn(Container, 'getDriverRecordRepository').mockReturnValue({
    list: mockList,
    index: mockIndex,
    bulkSetEnabled: mockBulkSetEnabled,
    findById: mockFindById,
    store: mockStore,
  })
  jest.spyOn(Container, 'getDriverTokenRecordRepository').mockReturnValue({
    findByDriverId: mockFindByDriverId,
  })
  jest.spyOn(Container, 'getRechargeRepository').mockReturnValue({
    create: mockRechargeCreate,
    listForDriver: mockRechargeListForDriver,
  } as any)
  mockRechargeCreate.mockReset()
  mockRechargeListForDriver.mockReset()
  jest.spyOn(Container, 'getMonthlyPaymentSettingsRepository').mockReturnValue({
    get: mockMonthlyPaymentSettingsGet,
    upsert: mockMonthlyPaymentSettingsUpsert,
  } as any)
  mockMonthlyPaymentSettingsGet.mockReset()
  mockMonthlyPaymentSettingsUpsert.mockReset()
  jest.spyOn(Container, 'getMonthlyPaymentRepository').mockReturnValue({
    create: mockMonthlyPaymentCreate,
    listForDriver: mockMonthlyPaymentListForDriver,
  } as any)
  mockMonthlyPaymentCreate.mockReset()
  mockMonthlyPaymentListForDriver.mockReset()
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
    it('calls index() and returns { success, data: { drivers, total } } when no filter/sort/page params are present', async () => {
      mockIndex.mockResolvedValue([{ id: 'drv-1' }])

      const { status, body } = await get(server, '/drivers', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.drivers).toHaveLength(1)
      expect(body.data.total).toBe(1)
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

// ---------------------------------------------------------------------------
// PATCH /drivers/:id/vehicles/:vehicleId — auto-promote on toggle to selectable=false
// ---------------------------------------------------------------------------

describe('PATCH /drivers/:id/vehicles/:vehicleId (selectable toggle — auto-promote)', () => {
  it('calls autoPromoteSelectedVehicle when selectable=false and that vehicle is the driver selected vehicle', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-selected'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockDriverVehicleSetSelectable.mockResolvedValue(undefined)
    // DriverRecord.findByPk returns a record whose selected_vehicle_id matches vehicleId
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: vehicleId }),
    })
    mockAutoPromoteSelectedVehicle.mockResolvedValue(undefined)

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: false },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockDriverVehicleSetSelectable).toHaveBeenCalledWith(driverId, vehicleId, false)
    expect(mockAutoPromoteSelectedVehicle).toHaveBeenCalledTimes(1)
    expect(mockAutoPromoteSelectedVehicle).toHaveBeenCalledWith(driverId)
  })

  it('does NOT call autoPromoteSelectedVehicle when selectable=false but that vehicle is NOT the driver selected vehicle', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-other'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockDriverVehicleSetSelectable.mockResolvedValue(undefined)
    // DriverRecord.findByPk returns a record whose selected_vehicle_id is a DIFFERENT vehicle
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: 'veh-selected' }),
    })

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: false },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockAutoPromoteSelectedVehicle).not.toHaveBeenCalled()
  })

  it('does NOT call autoPromoteSelectedVehicle when selectable=true', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-selected'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockDriverVehicleSetSelectable.mockResolvedValue(undefined)

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: true },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
    expect(mockAutoPromoteSelectedVehicle).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Confirmation gate (task 7.3) — selectable=false with active assignment
  // ---------------------------------------------------------------------------

  it('returns 409 vehicle_active with held_by when setting selectable=false and driver is currently using that vehicle', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-active'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Maria Driver' })
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      driver_id: driverId,
      vehicle_id: vehicleId,
      session_id: null,
      acquired_at: new Date(),
    })

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: false },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(409)
    expect(body.error).toBe('vehicle_active')
    expect(body.held_by).toEqual({ id: driverId, name: 'Maria Driver' })
    expect(mockForceDisconnect).not.toHaveBeenCalled()
    expect(mockDriverVehicleSetSelectable).not.toHaveBeenCalled()
  })

  it('calls forceDisconnect and returns 200 when setting selectable=false with confirmed=true and active assignment', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-active'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Maria Driver' })
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      driver_id: driverId,
      vehicle_id: vehicleId,
      session_id: null,
      acquired_at: new Date(),
    })
    mockDriverVehicleSetSelectable.mockResolvedValue(undefined)
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: vehicleId }),
    })
    mockAutoPromoteSelectedVehicle.mockResolvedValue(undefined)

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: false, confirmed: true },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockForceDisconnect).toHaveBeenCalledTimes(1)
    expect(mockForceDisconnect).toHaveBeenCalledWith(driverId, 'vehicle_not_selectable')
    expect(mockDriverVehicleSetSelectable).toHaveBeenCalledWith(driverId, vehicleId, false)
  })

  it('does NOT call forceDisconnect when driver has a different vehicle active (not the one being toggled)', async () => {
    const driverId = 'drv-1'
    const vehicleId = 'veh-other'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      driver_id: driverId,
      vehicle_id: 'veh-different',
      session_id: null,
      acquired_at: new Date(),
    })
    mockDriverVehicleSetSelectable.mockResolvedValue(undefined)
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: 'veh-selected' }),
    })

    const { status, body } = await patch(
      server,
      `/drivers/${driverId}/vehicles/${vehicleId}`,
      { selectable: false },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockForceDisconnect).not.toHaveBeenCalled()
    expect(mockDriverVehicleSetSelectable).toHaveBeenCalledWith(driverId, vehicleId, false)
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/:id/vehicles — find-or-create reuse without overwriting fields
// ---------------------------------------------------------------------------

describe('POST /drivers/:id/vehicles (find-or-create reuse)', () => {
  it('reuses existing vehicle row when plate already exists and does not overwrite brand', async () => {
    const driverId = 'drv-1'
    const existingVehicleId = 'veh-existing'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    // findOrCreateByPlate returns the existing vehicle (brand is the original one, not the one sent)
    const existingVehicle = {
      id: existingVehicleId,
      plate: 'ABC123',
      brand: 'OriginalBrand',
      model: null,
      color: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    }
    mockFindOrCreateByPlate.mockResolvedValue(existingVehicle)
    mockDriverVehicleLink.mockResolvedValue(undefined)
    // DriverRecord.findByPk returns driver with a non-null selected_vehicle_id (so no auto-set)
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: 'some-other-vehicle' }),
    })

    const { status, body } = await post(
      server,
      `/drivers/${driverId}/vehicles`,
      {
        vehicle: {
          plate: 'ABC123',
          brand: 'OtherBrand',
          model: 'Picanto',
          color: { name: 'Blue' },
        },
      },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.vehicle_id).toBe(existingVehicleId)
    // findOrCreateByPlate was called with the plate and full payload (brand included)
    // but since the vehicle already exists it returns the existing record unmodified
    expect(mockFindOrCreateByPlate).toHaveBeenCalledTimes(1)
    expect(mockFindOrCreateByPlate).toHaveBeenCalledWith(
      'ABC123',
      {
        plate: 'ABC123',
        brand: 'OtherBrand',
        model: 'Picanto',
        color: { name: 'Blue' },
      },
      mockTransaction
    )
    // link was created for the existing vehicle
    expect(mockDriverVehicleLink).toHaveBeenCalledWith(driverId, existingVehicleId, mockTransaction)
    // the returned vehicle_id is the existing one (not a new one)
    expect(body.data.vehicle_id).toBe(existingVehicleId)
  })

  it('sets selected_vehicle_id when driver has no selected vehicle yet', async () => {
    const driverId = 'drv-1'
    const newVehicleId = 'veh-new'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockFindOrCreateByPlate.mockResolvedValue({
      id: newVehicleId,
      plate: 'XYZ789',
      brand: 'Toyota',
    })
    mockDriverVehicleLink.mockResolvedValue(undefined)
    // DriverRecord.findByPk returns driver with selected_vehicle_id = null
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: null }),
    })
    mockDriverRecordUpdate.mockResolvedValue(undefined)

    const { status, body } = await post(
      server,
      `/drivers/${driverId}/vehicles`,
      {
        vehicle: {
          plate: 'XYZ789',
          brand: 'Toyota',
          model: 'Corolla',
          color: { name: 'White' },
        },
      },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    // selected_vehicle_id was set to the new vehicle
    expect(mockDriverRecordUpdate).toHaveBeenCalledTimes(1)
    const [updateData] = mockDriverRecordUpdate.mock.calls[0]
    expect(updateData.selected_vehicle_id).toBe(newVehicleId)
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/:id/selected-vehicle — rejection of ineligible vehicles
// ---------------------------------------------------------------------------

describe('POST /drivers/:id/selected-vehicle (ineligible vehicle rejection)', () => {
  it('returns 400 with error=vehicle_not_eligible when vehicleId is not in eligible list', async () => {
    const driverId = 'drv-1'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    // eligible list does NOT contain v-ineligible
    mockDriverVehicleFindEligibleForDriver.mockResolvedValue([
      { vehicle_id: 'veh-eligible', selectable: true, vehicle: { enabled: true } },
    ])

    const { status, body } = await post(
      server,
      `/drivers/${driverId}/selected-vehicle`,
      { vehicleId: 'v-ineligible' },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(400)
    expect(body.error).toBe('vehicle_not_eligible')
    expect(mockDriverRecordUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 when vehicleId is in the eligible list', async () => {
    const driverId = 'drv-1'
    const eligibleVehicleId = 'veh-eligible'

    mockFindById.mockResolvedValue({ id: driverId, name: 'Test Driver' })
    mockDriverVehicleFindEligibleForDriver.mockResolvedValue([
      { vehicle_id: eligibleVehicleId, selectable: true, vehicle: { enabled: true } },
    ])
    mockDriverRecordUpdate.mockResolvedValue(undefined)

    const { status, body } = await post(
      server,
      `/drivers/${driverId}/selected-vehicle`,
      { vehicleId: eligibleVehicleId },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockDriverRecordUpdate).toHaveBeenCalledTimes(1)
    const [updateData] = mockDriverRecordUpdate.mock.calls[0]
    expect(updateData.selected_vehicle_id).toBe(eligibleVehicleId)
  })

  it('returns 404 when driver is not found', async () => {
    mockFindById.mockResolvedValue(null)

    const { status, body } = await post(
      server,
      '/drivers/nonexistent/selected-vehicle',
      { vehicleId: 'veh-1' },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockDriverVehicleFindEligibleForDriver).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /drivers — create driver (new shape and legacy shape)
// ---------------------------------------------------------------------------

describe('POST /drivers (DriversController)', () => {
  const createdDriver = {
    id: 'drv-new',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '555-1234',
    docType: 'cc',
    document: '123456',
    paymentMode: 'monthly',
    balance: 0,
    enabled_at: 0,
    created_at: 0,
    last_connection: 0,
    vehicle: {},
  }

  it('creates driver using new shape { driver, vehicle }', async () => {
    mockStore.mockResolvedValue(createdDriver)
    mockFindOrCreateByPlate.mockResolvedValue({ id: 'veh-1', plate: 'ABC123' })
    mockDriverVehicleLink.mockResolvedValue(undefined)
    mockDriverRecordUpdate.mockResolvedValue(undefined)

    const { status, body } = await post(
      server,
      '/drivers',
      { driver: { name: 'John Doe' }, vehicle: { plate: 'ABC123' } },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(mockStore).toHaveBeenCalledWith({ name: 'John Doe' })
    expect(mockFindOrCreateByPlate).toHaveBeenCalledWith('ABC123', { plate: 'ABC123' })
    expect(mockDriverVehicleLink).toHaveBeenCalledWith('drv-new', 'veh-1')
    expect(mockDriverRecordUpdate).toHaveBeenCalledTimes(1)
  })

  it('creates driver using new shape with { vehicleId } — links by id without find-or-create', async () => {
    mockStore.mockResolvedValue(createdDriver)
    mockDriverVehicleLink.mockResolvedValue(undefined)
    mockDriverRecordUpdate.mockResolvedValue(undefined)

    const { status, body } = await post(
      server,
      '/drivers',
      { driver: { name: 'John Doe' }, vehicle: { vehicleId: 'veh-existing' } },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(mockFindOrCreateByPlate).not.toHaveBeenCalled()
    expect(mockDriverVehicleLink).toHaveBeenCalledWith('drv-new', 'veh-existing')
  })

  it('creates driver using legacy inline shape and logs deprecation', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockStore.mockResolvedValue(createdDriver)

    const { status, body } = await post(
      server,
      '/drivers',
      { name: 'John Doe', email: 'john@example.com' },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEPRECATED]'))
    consoleSpy.mockRestore()
  })

  it('creates driver without vehicle payload — no link is created', async () => {
    mockStore.mockResolvedValue(createdDriver)

    const { status, body } = await post(
      server,
      '/drivers',
      { driver: { name: 'John Doe' } },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(mockDriverVehicleLink).not.toHaveBeenCalled()
    expect(mockFindOrCreateByPlate).not.toHaveBeenCalled()
  })

  it('calls Store.refreshDrivers() after creating a driver', async () => {
    mockStore.mockResolvedValue(createdDriver)

    await post(server, '/drivers', { driver: { name: 'John Doe' } }, VALID_AUTH_HEADERS)

    expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// PUT /drivers/:id — update driver (new shape and legacy shape)
// ---------------------------------------------------------------------------

describe('PUT /drivers/:id (DriversController)', () => {
  const updatedDriver = {
    id: 'drv-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-5678',
    docType: 'cc',
    document: '654321',
    paymentMode: 'monthly',
    balance: 0,
    enabled_at: 0,
    created_at: 0,
    last_connection: 0,
    vehicle: {},
  }

  it('updates driver using new shape { driver } and strips vehicle field', async () => {
    mockStore.mockResolvedValue(updatedDriver)

    const { status, body } = await put(
      server,
      '/drivers/drv-1',
      { driver: { name: 'Jane Doe', vehicle: { plate: 'SHOULD_BE_STRIPPED' } } },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    // vehicle must not be forwarded to store
    const [storeArg] = mockStore.mock.calls[0]
    expect(storeArg.vehicle).toBeUndefined()
    expect(storeArg.id).toBe('drv-1')
  })

  it('updates driver using legacy inline shape, strips vehicle, and logs deprecation', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockStore.mockResolvedValue(updatedDriver)

    const { status, body } = await put(
      server,
      '/drivers/drv-1',
      { name: 'Jane Doe', vehicle: { plate: 'OLD_PLATE' } },
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEPRECATED]'))
    const [storeArg] = mockStore.mock.calls[0]
    expect(storeArg.vehicle).toBeUndefined()
    consoleSpy.mockRestore()
  })

  it('calls Store.refreshDrivers() after updating a driver', async () => {
    mockStore.mockResolvedValue(updatedDriver)

    await put(server, '/drivers/drv-1', { driver: { name: 'Jane Doe' } }, VALID_AUTH_HEADERS)

    expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// GET /drivers/:id — enriched response with selected_vehicle, roster, active_vehicle_id
// ---------------------------------------------------------------------------

describe('GET /drivers/:id (DriversController)', () => {
  const baseDriver = {
    id: 'drv-1',
    name: 'Test Driver',
    email: 'driver@test.com',
    phone: '555-0000',
    docType: 'cc',
    document: '111111',
    paymentMode: 'monthly',
    balance: 0,
    enabled_at: 0,
    created_at: 0,
    last_connection: 0,
    vehicle: { plate: 'OLD123' },
    selected_vehicle_id: 'veh-1',
  }

  it('returns 404 when driver is not found', async () => {
    mockFindById.mockResolvedValue(null)

    const { status, body } = await get(server, '/drivers/nonexistent', VALID_AUTH_HEADERS)

    expect(status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('returns enriched driver without vehicle field, with selected_vehicle, roster, active_vehicle_id', async () => {
    mockFindById.mockResolvedValue(baseDriver)
    mockDriverVehicleListForDriver.mockResolvedValue([
      { vehicle_id: 'veh-1', selectable: true, vehicle: { id: 'veh-1', plate: 'ABC123' } },
    ])
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      vehicle_id: 'veh-1',
      driver_id: 'drv-1',
      session_id: null,
      acquired_at: new Date(),
    })
    mockVehicleRepoFindById.mockResolvedValue({ id: 'veh-1', plate: 'ABC123', brand: 'Toyota' })

    const { status, body } = await get(server, '/drivers/drv-1', VALID_AUTH_HEADERS)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const driver = body.data.driver
    // vehicle JSONB field must be omitted
    expect(driver.vehicle).toBeUndefined()
    // new fields must be present
    expect(driver.selected_vehicle).toEqual({ id: 'veh-1', plate: 'ABC123', brand: 'Toyota' })
    expect(driver.roster).toHaveLength(1)
    expect(driver.active_vehicle_id).toBe('veh-1')
  })

  it('returns selected_vehicle=null when selected_vehicle_id is null', async () => {
    mockFindById.mockResolvedValue({ ...baseDriver, selected_vehicle_id: null })
    mockDriverVehicleListForDriver.mockResolvedValue([])
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue(null)

    const { status, body } = await get(server, '/drivers/drv-1', VALID_AUTH_HEADERS)

    expect(status).toBe(200)
    expect(body.data.driver.selected_vehicle).toBeNull()
    expect(body.data.driver.active_vehicle_id).toBeNull()
    expect(mockVehicleRepoFindById).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/:id/recharges
// ---------------------------------------------------------------------------

describe('POST /drivers/:id/recharges (DriversController)', () => {
  const validBody = {
    amount: 5000,
    created_by: { uid: 'admin-uid', name: 'Admin User' },
    note: 'recarga efectivo',
  }
  const rechargeResult = {
    recharge: {
      id: 'rch-1',
      driverId: 'drv-1',
      amount: 5000,
      balanceBefore: 1000,
      balanceAfter: 6000,
      createdByUid: 'admin-uid',
      createdByName: 'Admin User',
      note: 'recarga efectivo',
      created_at: 1000000,
    },
    driver: { id: 'drv-1', balance: 6000 },
  }

  describe('201: successful recharge', () => {
    it('creates recharge and returns recharge + driver', async () => {
      mockRechargeCreate.mockResolvedValue(rechargeResult)

      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        validBody,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.data.recharge).toEqual(rechargeResult.recharge)
      expect(body.data.driver).toEqual(rechargeResult.driver)
      expect(mockRechargeCreate).toHaveBeenCalledTimes(1)
      expect(mockRechargeCreate).toHaveBeenCalledWith({
        driverId: 'drv-1',
        amount: 5000,
        createdBy: { uid: 'admin-uid', name: 'Admin User' },
        note: 'recarga efectivo',
      })
    })

    it('calls store.refreshDrivers() after successful recharge', async () => {
      mockRechargeCreate.mockResolvedValue(rechargeResult)

      await post(server, '/drivers/drv-1/recharges', validBody, VALID_AUTH_HEADERS)

      expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
    })
  })

  describe('400: validation errors', () => {
    it('returns 400 when amount is missing', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        { created_by: { uid: 'u', name: 'n' } },
        VALID_AUTH_HEADERS
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockRechargeCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when amount is zero', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        { amount: 0, created_by: { uid: 'u', name: 'n' } },
        VALID_AUTH_HEADERS
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockRechargeCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when amount is a string', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        { amount: '5000', created_by: { uid: 'u', name: 'n' } },
        VALID_AUTH_HEADERS
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
    })

    it('returns 400 when created_by is missing', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        { amount: 5000 },
        VALID_AUTH_HEADERS
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockRechargeCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when created_by.uid is missing', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/recharges',
        { amount: 5000, created_by: { name: 'Admin' } },
        VALID_AUTH_HEADERS
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
    })
  })

  describe('404: driver not found', () => {
    it('returns 404 when repository throws Driver not found', async () => {
      mockRechargeCreate.mockRejectedValue(new Error('Driver not found'))

      const { status, body } = await post(
        server,
        '/drivers/nonexistent/recharges',
        validBody,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(404)
      expect(body.success).toBe(false)
      expect(mockRefreshDrivers).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// GET /drivers/:id/recharges
// ---------------------------------------------------------------------------

describe('GET /drivers/:id/recharges (DriversController)', () => {
  const sampleRecharges = [
    {
      id: 'rch-2',
      driverId: 'drv-1',
      amount: -2000,
      balanceBefore: 6000,
      balanceAfter: 4000,
      createdByUid: 'u',
      createdByName: 'Admin',
      note: null,
      created_at: 1000100,
    },
    {
      id: 'rch-1',
      driverId: 'drv-1',
      amount: 5000,
      balanceBefore: 1000,
      balanceAfter: 6000,
      createdByUid: 'u',
      createdByName: 'Admin',
      note: 'recarga',
      created_at: 1000000,
    },
  ]

  describe('200: returns paginated history', () => {
    it('returns recharges and total', async () => {
      mockRechargeListForDriver.mockResolvedValue({ rows: sampleRecharges, total: 2 })

      const { status, body } = await get(server, '/drivers/drv-1/recharges', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.recharges).toHaveLength(2)
      expect(body.data.total).toBe(2)
      expect(mockRechargeListForDriver).toHaveBeenCalledWith('drv-1', { page: 1, perPage: 20 })
    })

    it('returns empty list when driver has no recharges', async () => {
      mockRechargeListForDriver.mockResolvedValue({ rows: [], total: 0 })

      const { status, body } = await get(server, '/drivers/drv-1/recharges', VALID_AUTH_HEADERS)

      expect(status).toBe(200)
      expect(body.data.recharges).toEqual([])
      expect(body.data.total).toBe(0)
    })

    it('forwards page and perPage query params', async () => {
      mockRechargeListForDriver.mockResolvedValue({ rows: [], total: 0 })

      await get(server, '/drivers/drv-1/recharges?page=2&perPage=10', VALID_AUTH_HEADERS)

      expect(mockRechargeListForDriver).toHaveBeenCalledWith('drv-1', { page: 2, perPage: 10 })
    })
  })
})

describe('GET /drivers/monthly-payment-settings — route ordering (DriversController)', () => {
  it('hits the settings handler and is not treated as a driver lookup by id', async () => {
    const settings = {
      id: 'default',
      suggested_amount: 90000,
      auto_disable: true,
      cutoff_day: 4,
      reminder_offsets: [3, 1],
    }
    mockMonthlyPaymentSettingsGet.mockResolvedValue(settings)

    const { status, body } = await get(
      server,
      '/drivers/monthly-payment-settings',
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual(settings)
    expect(mockMonthlyPaymentSettingsGet).toHaveBeenCalledTimes(1)
    expect(mockFindById).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /drivers/:id/monthly-payments
// ---------------------------------------------------------------------------

describe('POST /drivers/:id/monthly-payments (DriversController)', () => {
  const validBody = {
    amount: 90000,
    period: '2026-06',
    created_by: { uid: 'admin-uid', name: 'Admin User' },
    note: 'efectivo',
  }
  const paymentResult = {
    payment: {
      id: 'mp-1',
      driverId: 'drv-1',
      period: '2026-06',
      amount: 90000,
      createdByUid: 'admin-uid',
      createdByName: 'Admin User',
      note: 'efectivo',
      created_at: 1000000,
    },
    driver: { id: 'drv-1', enabled_at: 1000000 },
  }

  describe('201: successful registration', () => {
    it('creates monthly payment and returns payment + driver', async () => {
      mockMonthlyPaymentCreate.mockResolvedValue(paymentResult)

      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        validBody,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.data.payment).toEqual(paymentResult.payment)
      expect(body.data.driver).toEqual(paymentResult.driver)
      expect(mockMonthlyPaymentCreate).toHaveBeenCalledTimes(1)
      expect(mockMonthlyPaymentCreate).toHaveBeenCalledWith({
        driverId: 'drv-1',
        period: '2026-06',
        amount: 90000,
        createdBy: { uid: 'admin-uid', name: 'Admin User' },
        note: 'efectivo',
      })
    })

    it('calls store.refreshDrivers() after successful registration', async () => {
      mockMonthlyPaymentCreate.mockResolvedValue(paymentResult)

      await post(server, '/drivers/drv-1/monthly-payments', validBody, VALID_AUTH_HEADERS)

      expect(mockRefreshDrivers).toHaveBeenCalledTimes(1)
    })

    it('defaults period to the current Bogota period when omitted', async () => {
      mockMonthlyPaymentCreate.mockResolvedValue(paymentResult)
      const { period: _period, ...bodyWithoutPeriod } = validBody

      await post(server, '/drivers/drv-1/monthly-payments', bodyWithoutPeriod, VALID_AUTH_HEADERS)

      expect(mockMonthlyPaymentCreate).toHaveBeenCalledTimes(1)
      const [callArg] = mockMonthlyPaymentCreate.mock.calls[0]
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { currentPeriod } = require('../../../../Services/time/BogotaTime')
      expect(callArg.period).toBe(currentPeriod())
    })
  })

  describe('200/201: zero amount is accepted (divergence from /recharges)', () => {
    it('accepts amount = 0 and creates the payment', async () => {
      mockMonthlyPaymentCreate.mockResolvedValue({
        payment: { ...paymentResult.payment, amount: 0 },
        driver: paymentResult.driver,
      })

      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, amount: 0 },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(201)
      expect(body.success).toBe(true)
      expect(mockMonthlyPaymentCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 0 }))
    })
  })

  describe('400: validation errors', () => {
    it('returns 400 when amount is negative', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, amount: -1 },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockMonthlyPaymentCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when amount is a non-numeric string', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, amount: '90000' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockMonthlyPaymentCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when created_by is missing', async () => {
      const { created_by: _createdBy, ...bodyWithoutActor } = validBody

      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        bodyWithoutActor,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockMonthlyPaymentCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when created_by.uid is missing', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, created_by: { name: 'Admin User' } },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockMonthlyPaymentCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when period does not match YYYY-MM', async () => {
      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, period: '2026/06' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(mockMonthlyPaymentCreate).not.toHaveBeenCalled()
    })
  })

  describe('404: driver not found', () => {
    it('returns 404 when repository throws Driver not found', async () => {
      mockMonthlyPaymentCreate.mockRejectedValue(new Error('Driver not found'))

      const { status, body } = await post(
        server,
        '/drivers/nonexistent/monthly-payments',
        validBody,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(404)
      expect(body.success).toBe(false)
      expect(mockRefreshDrivers).not.toHaveBeenCalled()
    })
  })

  describe('current-vs-past period re-enable passthrough', () => {
    it('passes the explicit current period through to the repository and forwards the re-enabled driver in the response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { currentPeriod } = require('../../../../Services/time/BogotaTime')
      const reenabledResult = {
        payment: { ...paymentResult.payment, period: currentPeriod() },
        driver: { id: 'drv-1', enabled_at: 1700000000 },
      }
      mockMonthlyPaymentCreate.mockResolvedValue(reenabledResult)

      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, period: currentPeriod() },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(201)
      expect(mockMonthlyPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ period: currentPeriod() })
      )
      expect(body.data.driver.enabled_at).toBe(1700000000)
    })

    it('passes a past period through to the repository and forwards the unchanged (still-disabled) driver in the response', async () => {
      const pastPeriodResult = {
        payment: { ...paymentResult.payment, period: '2020-01' },
        driver: { id: 'drv-1', enabled_at: 0 },
      }
      mockMonthlyPaymentCreate.mockResolvedValue(pastPeriodResult)

      const { status, body } = await post(
        server,
        '/drivers/drv-1/monthly-payments',
        { ...validBody, period: '2020-01' },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(201)
      expect(mockMonthlyPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ period: '2020-01' })
      )
      expect(body.data.driver.enabled_at).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// GET /drivers/:id/monthly-payments
// ---------------------------------------------------------------------------

describe('GET /drivers/:id/monthly-payments (DriversController)', () => {
  const samplePayments = [
    {
      id: 'mp-2',
      driverId: 'drv-1',
      period: '2026-06',
      amount: 90000,
      createdByUid: 'u',
      createdByName: 'Admin',
      note: null,
      created_at: 1000100,
    },
    {
      id: 'mp-1',
      driverId: 'drv-1',
      period: '2026-05',
      amount: 90000,
      createdByUid: 'u',
      createdByName: 'Admin',
      note: 'efectivo',
      created_at: 1000000,
    },
  ]

  describe('200: returns paginated history', () => {
    it('returns rows and total', async () => {
      mockMonthlyPaymentListForDriver.mockResolvedValue({ rows: samplePayments, total: 2 })

      const { status, body } = await get(
        server,
        '/drivers/drv-1/monthly-payments',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.rows).toHaveLength(2)
      expect(body.data.total).toBe(2)
      expect(mockMonthlyPaymentListForDriver).toHaveBeenCalledWith('drv-1', {
        page: 1,
        perPage: 20,
      })
    })

    it('returns empty list when driver has no payments', async () => {
      mockMonthlyPaymentListForDriver.mockResolvedValue({ rows: [], total: 0 })

      const { status, body } = await get(
        server,
        '/drivers/drv-1/monthly-payments',
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.data.rows).toEqual([])
      expect(body.data.total).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// GET/PUT /drivers/monthly-payment-settings
// ---------------------------------------------------------------------------

describe('GET /drivers/monthly-payment-settings (DriversController)', () => {
  it('returns the current settings', async () => {
    const settings = {
      id: 'default',
      suggested_amount: 90000,
      auto_disable: true,
      cutoff_day: 4,
      reminder_offsets: [3, 1],
    }
    mockMonthlyPaymentSettingsGet.mockResolvedValue(settings)

    const { status, body } = await get(
      server,
      '/drivers/monthly-payment-settings',
      VALID_AUTH_HEADERS
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual(settings)
  })
})

describe('PUT /drivers/monthly-payment-settings (DriversController)', () => {
  const validSettingsBody = {
    suggested_amount: 90000,
    auto_disable: true,
    cutoff_day: 4,
    reminder_offsets: [3, 1],
  }

  describe('200: successful update', () => {
    it('upserts settings and returns the persisted values', async () => {
      mockMonthlyPaymentSettingsUpsert.mockResolvedValue(validSettingsBody)

      const { status, body } = await put(
        server,
        '/drivers/monthly-payment-settings',
        validSettingsBody,
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toEqual(validSettingsBody)
      expect(mockMonthlyPaymentSettingsUpsert).toHaveBeenCalledWith(validSettingsBody)
    })
  })

  describe('400: validation errors', () => {
    it('returns 400 and the repository error message when cutoff_day is invalid', async () => {
      mockMonthlyPaymentSettingsUpsert.mockRejectedValue(
        new Error('Invalid cutoff_day: must be between 1 and 28')
      )

      const { status, body } = await put(
        server,
        '/drivers/monthly-payment-settings',
        { ...validSettingsBody, cutoff_day: 0 },
        VALID_AUTH_HEADERS
      )

      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.message).toMatch(/Invalid cutoff_day/)
    })
  })
})

describe('GET /public/drivers/:id (PublicDriversController)', () => {
  const baseDriver = {
    id: 'drv-public-1',
    name: 'Public Driver',
    email: 'driver@test.com',
    phone: '555-0000',
    docType: 'cc',
    document: '111111',
    paymentMode: 'monthly',
    balance: 0,
    enabled_at: 0,
    created_at: 0,
    last_connection: 0,
    vehicle: { plate: 'LEGACY123' },
    selected_vehicle_id: 'veh-2',
  }

  it('returns selected_vehicle_id, selected_vehicle, and a flat Android-compatible roster', async () => {
    mockFindById.mockResolvedValue(baseDriver)
    mockDriverVehicleListForDriver.mockResolvedValue([
      {
        vehicle_id: 'veh-2',
        selectable: true,
        vehicle: {
          id: 'veh-2',
          plate: 'ABC123',
          brand: 'Toyota',
          model: 'Yaris',
          photoUrl: 'https://img/1.png',
          color: { name: 'White' },
          enabled: true,
        },
      },
      {
        vehicle_id: 'veh-3',
        selectable: true,
        vehicle: {
          id: 'veh-3',
          plate: 'XYZ789',
          brand: 'Mazda',
          model: '2',
          photoUrl: null,
          color: { name: 'Red' },
          enabled: false,
        },
      },
    ])
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      vehicle_id: 'veh-3',
      driver_id: 'drv-public-1',
      session_id: null,
      acquired_at: new Date(),
    })

    const { status, body } = await get(server, '/public/drivers/drv-public-1')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockDriverVehicleListForDriver).toHaveBeenCalledWith('drv-public-1', {
      includeAll: true,
    })

    const driver = body.data.driver
    expect(driver.selected_vehicle_id).toBe('veh-2')
    expect(driver.selected_vehicle).toEqual({
      id: 'veh-2',
      plate: 'ABC123',
      brand: 'Toyota',
      model: 'Yaris',
      photoUrl: 'https://img/1.png',
      color: { name: 'White' },
      enabled: true,
      is_selected: true,
      is_selectable: true,
      is_active: false,
    })
    expect(driver.roster).toEqual([
      {
        id: 'veh-2',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Yaris',
        photoUrl: 'https://img/1.png',
        color: { name: 'White' },
        enabled: true,
        is_selected: true,
        is_selectable: true,
        is_active: false,
      },
      {
        id: 'veh-3',
        plate: 'XYZ789',
        brand: 'Mazda',
        model: '2',
        photoUrl: null,
        color: { name: 'Red' },
        enabled: false,
        is_selected: false,
        is_selectable: false,
        is_active: true,
      },
    ])
    expect(driver.roster.filter((vehicle: any) => vehicle.is_selected)).toHaveLength(1)
    expect(driver.roster[0].vehicle).toBeUndefined()
  })
})
