import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'
import { UniqueConstraintError } from 'sequelize'

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

// requireDriverAuth — passthrough that injects a fixed driverUid
jest.mock('../../../../Middlewares/Authorization', () => ({
  requireDriverAuth: jest.fn((_req: any, _res: any, next: any) => {
    _req.driverUid = 'test-driver-uid'
    next()
  }),
}))

// DriverRecord — Sequelize Model used directly in DriverAppController
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

// VehicleRecord — Sequelize Model used directly in DriverAppController
const mockVehicleRecordFindByPk = jest.fn()
jest.mock('../../../../Models/VehicleRecord', () => ({
  __esModule: true,
  default: {
    findByPk: mockVehicleRecordFindByPk,
  },
}))

// ActiveVehicleAssignmentRecord — Sequelize Model used directly in DriverAppController
const mockActiveVehicleAssignmentCreate = jest.fn()
jest.mock('../../../../Models/ActiveVehicleAssignmentRecord', () => ({
  __esModule: true,
  default: {
    create: mockActiveVehicleAssignmentCreate,
  },
}))

// ActiveVehicleAssignmentRepository — singleton default export
const mockActiveVehicleAssignmentFindByVehicle = jest.fn()
const mockActiveVehicleAssignmentReleaseByDriver = jest.fn()
const mockActiveVehicleAssignmentFindByDriver = jest.fn()
jest.mock('../../../../Repositories/ActiveVehicleAssignmentRepository', () => ({
  __esModule: true,
  default: {
    findByVehicle: mockActiveVehicleAssignmentFindByVehicle,
    findByDriver: mockActiveVehicleAssignmentFindByDriver,
    releaseByDriver: mockActiveVehicleAssignmentReleaseByDriver,
    releaseByVehicle: jest.fn(),
    acquire: jest.fn(),
  },
}))

// DriverVehicleRepository — class instantiated at module-level in DriverAppController
const mockDriverVehicleListForDriver = jest.fn()
const mockDriverVehicleFindEligibleForDriver = jest.fn()
jest.mock('../../../../Repositories/DriverVehicleRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    listForDriver: mockDriverVehicleListForDriver,
    link: jest.fn(),
    setSelectable: jest.fn(),
    findEligibleForDriver: mockDriverVehicleFindEligibleForDriver,
    findMostRecentEligible: jest.fn(),
  })),
}))

// DatabaseService — firebase RTDB singleton
const mockRtdbChildSet = jest.fn()
const mockRtdbChildRemove = jest.fn()
const mockRtdbChild = jest.fn(() => ({
  set: mockRtdbChildSet,
  remove: mockRtdbChildRemove,
}))
jest.mock('../../../../Services/firebase/Database', () => ({
  __esModule: true,
  default: {
    dbConnectedDrivers: jest.fn(() => ({
      child: mockRtdbChild,
    })),
  },
}))

// Database/sequelize — transaction() is spied on per-test in beforeEach.
// We do NOT mock the whole module here because Container.ts loads Models at
// module evaluation time; a stub Sequelize instance breaks Model.init().
const mockTransactionCommit = jest.fn().mockResolvedValue(undefined)
const mockTransactionRollback = jest.fn().mockResolvedValue(undefined)
const mockTransaction = { commit: mockTransactionCommit, rollback: mockTransactionRollback }

// Container is required after mocks so spyOn works correctly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Container = require('../../../../Container/Container').default

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let server: http.Server

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controller = require('../DriverAppController').default
  const app = express()
  app.use(express.json())
  app.use('/driver-app', controller)
  server = http.createServer(app)
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

beforeEach(() => {
  jest.clearAllMocks()

  // Reset transaction mocks
  mockTransactionCommit.mockResolvedValue(undefined)
  mockTransactionRollback.mockResolvedValue(undefined)

  // Spy on sequelize.transaction per-test
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sequelizeInstance = require('../../../../Database/sequelize').default
  jest.spyOn(sequelizeInstance, 'transaction').mockResolvedValue(mockTransaction as any)

  // Spy on Container methods needed by DriverAppController
  jest.spyOn(Container, 'getServiceHistoryRepository').mockReturnValue({
    listByDriver: jest.fn().mockResolvedValue([]),
  })
  jest.spyOn(Container, 'getDriverTokenRecordRepository').mockReturnValue({
    upsert: jest.fn().mockResolvedValue({}),
    deleteByDriverId: jest.fn().mockResolvedValue(undefined),
  })

  // Reset RTDB mocks
  mockRtdbChild.mockReturnValue({
    set: mockRtdbChildSet,
    remove: mockRtdbChildRemove,
  })
  mockRtdbChildSet.mockResolvedValue(undefined)
  mockRtdbChildRemove.mockResolvedValue(undefined)
  mockDriverRecordUpdate.mockReset()
  mockActiveVehicleAssignmentFindByDriver.mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// POST /driver-app/me/connect — test cases
// ---------------------------------------------------------------------------

const DRIVER_UID = 'test-driver-uid'
const VEHICLE_ID = 'veh-uuid-123'

function makeEnabledDriver(overrides: Record<string, any> = {}) {
  return {
    get: (_opts: any) => ({
      id: DRIVER_UID,
      name: 'Test Driver',
      enabled_at: '1700000000',
      ...overrides,
    }),
  }
}

function makeEnabledVehicle(overrides: Record<string, any> = {}) {
  return {
    get: (_opts: any) => ({ id: VEHICLE_ID, plate: 'ABC123', enabled: true, ...overrides }),
  }
}

function makeLink(overrides: Record<string, any> = {}) {
  return {
    vehicle_id: VEHICLE_ID,
    selectable: true,
    ...overrides,
  }
}

describe('POST /driver-app/me/connect (DriverAppController)', () => {
  describe('400: vehicle_disabled', () => {
    it('returns 400 with error=vehicle_disabled when vehicle.enabled is false', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle({ enabled: false }))

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(400)
      expect(body.error).toBe('vehicle_disabled')
      expect(mockActiveVehicleAssignmentCreate).not.toHaveBeenCalled()
    })
  })

  describe('400: vehicle_not_selectable', () => {
    it('returns 400 with error=vehicle_not_selectable when no link exists for that vehicle', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      // No link for this vehicle
      mockDriverVehicleListForDriver.mockResolvedValue([])

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(400)
      expect(body.error).toBe('vehicle_not_selectable')
      expect(mockActiveVehicleAssignmentCreate).not.toHaveBeenCalled()
    })

    it('returns 400 with error=vehicle_not_selectable when link exists but selectable=false', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink({ selectable: false })])

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(400)
      expect(body.error).toBe('vehicle_not_selectable')
      expect(mockActiveVehicleAssignmentCreate).not.toHaveBeenCalled()
    })
  })

  describe('403: driver_disabled', () => {
    it('returns 403 with error=driver_disabled when driver.enabled_at is null', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver({ enabled_at: null }))

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(403)
      expect(body.error).toBe('driver_disabled')
      expect(mockVehicleRecordFindByPk).not.toHaveBeenCalled()
      expect(mockActiveVehicleAssignmentCreate).not.toHaveBeenCalled()
    })

    it('returns 403 with error=driver_disabled when driver.enabled_at is 0', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver({ enabled_at: 0 }))

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(403)
      expect(body.error).toBe('driver_disabled')
    })
  })

  describe('409: vehicle_in_use', () => {
    it('returns 409 with error=vehicle_in_use and held_by when vehicle PK constraint fires', async () => {
      const holderDriverId = 'holder-driver-uid'
      mockDriverRecordFindByPk
        .mockResolvedValueOnce(makeEnabledDriver()) // for the requesting driver
        .mockResolvedValueOnce({
          // for the holder driver lookup
          get: (_opts: any) => ({ id: holderDriverId, name: 'Holder Driver' }),
        })
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink()])

      // Simulate PK constraint violation on vehicle_id
      const pkError = new UniqueConstraintError({ errors: [] })
      ;(pkError as any).parent = { constraint: 'active_vehicle_assignments_pkey' }
      mockActiveVehicleAssignmentCreate.mockRejectedValue(pkError)

      // The repository is asked who holds the vehicle
      mockActiveVehicleAssignmentFindByVehicle.mockResolvedValue({
        vehicle_id: VEHICLE_ID,
        driver_id: holderDriverId,
        session_id: null,
        acquired_at: new Date(),
      })

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(409)
      expect(body.error).toBe('vehicle_in_use')
      expect(body.held_by).toEqual({ id: holderDriverId, name: 'Holder Driver' })
      expect(mockTransactionRollback).toHaveBeenCalledTimes(1)
      expect(mockRtdbChildSet).not.toHaveBeenCalled()
    })

    it('returns 409 with error=vehicle_in_use and held_by=null when no assignment record is found', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink()])

      const pkError = new UniqueConstraintError({ errors: [] })
      ;(pkError as any).parent = { constraint: 'active_vehicle_assignments_pkey' }
      mockActiveVehicleAssignmentCreate.mockRejectedValue(pkError)
      mockActiveVehicleAssignmentFindByVehicle.mockResolvedValue(null)

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(409)
      expect(body.error).toBe('vehicle_in_use')
      expect(body.held_by).toBeNull()
    })
  })

  describe('409: driver_already_connected', () => {
    it('returns 409 with error=driver_already_connected when driver_id unique constraint fires', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink()])

      // Simulate unique constraint on driver_id column
      const driverError = new UniqueConstraintError({ errors: [] })
      ;(driverError as any).parent = { constraint: 'active_vehicle_assignments_driver_id_key' }
      mockActiveVehicleAssignmentCreate.mockRejectedValue(driverError)

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(409)
      expect(body.error).toBe('driver_already_connected')
      expect(mockTransactionRollback).toHaveBeenCalledTimes(1)
      expect(mockRtdbChildSet).not.toHaveBeenCalled()
    })
  })

  describe('200: success', () => {
    it('returns 200, commits txn, and writes RTDB presence on happy path', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink()])
      mockActiveVehicleAssignmentCreate.mockResolvedValue({})
      mockRtdbChildSet.mockResolvedValue(undefined)

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
        session_id: 'sess-abc',
      })

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockActiveVehicleAssignmentCreate).toHaveBeenCalledTimes(1)
      expect(mockActiveVehicleAssignmentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle_id: VEHICLE_ID,
          driver_id: DRIVER_UID,
          session_id: 'sess-abc',
        }),
        { transaction: mockTransaction }
      )
      expect(mockRtdbChild).toHaveBeenCalledWith(DRIVER_UID)
      expect(mockRtdbChildSet).toHaveBeenCalledTimes(1)
      expect(mockRtdbChildSet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: DRIVER_UID,
          vehicle_id: VEHICLE_ID,
          vehicle_plate: 'ABC123',
          session_id: 'sess-abc',
        })
      )
      expect(mockTransactionCommit).toHaveBeenCalledTimes(1)
      expect(mockTransactionRollback).not.toHaveBeenCalled()
    })

    it('rolls back and returns 503 when RTDB write fails', async () => {
      mockDriverRecordFindByPk.mockResolvedValue(makeEnabledDriver())
      mockVehicleRecordFindByPk.mockResolvedValue(makeEnabledVehicle())
      mockDriverVehicleListForDriver.mockResolvedValue([makeLink()])
      mockActiveVehicleAssignmentCreate.mockResolvedValue({})
      mockRtdbChildSet.mockRejectedValue(new Error('RTDB unavailable'))

      const { status, body } = await post(server, '/driver-app/me/connect', {
        vehicle_id: VEHICLE_ID,
      })

      expect(status).toBe(503)
      expect(body.error).toBe('presence_unavailable')
      expect(mockTransactionRollback).toHaveBeenCalledTimes(1)
      expect(mockTransactionCommit).not.toHaveBeenCalled()
    })
  })
})

describe('GET /driver-app/me/vehicles (DriverAppController)', () => {
  it('returns both selectable and is_selectable using the enabled/selectable roster filter', async () => {
    mockDriverVehicleListForDriver.mockResolvedValue([
      {
        vehicle_id: 'veh-eligible',
        selectable: true,
        vehicle: {
          id: 'veh-eligible',
          plate: 'ABC123',
          brand: 'Toyota',
          model: 'Yaris',
          photoUrl: 'https://img/1.png',
          color: { name: 'White' },
          enabled: true,
        },
      },
    ])
    mockDriverRecordFindByPk.mockResolvedValue({
      get: (_opts: any) => ({ selected_vehicle_id: 'veh-eligible' }),
    })
    mockActiveVehicleAssignmentFindByDriver.mockResolvedValue({
      vehicle_id: 'veh-eligible',
      driver_id: DRIVER_UID,
      session_id: null,
      acquired_at: new Date(),
    })

    const { status, body } = await get(server, '/driver-app/me/vehicles')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockDriverVehicleListForDriver).toHaveBeenCalledWith(DRIVER_UID, {
      includeAll: false,
    })
    expect(body.data.vehicles).toEqual([
      {
        id: 'veh-eligible',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Yaris',
        photoUrl: 'https://img/1.png',
        color: { name: 'White' },
        enabled: true,
        vehicle_id: 'veh-eligible',
        selectable: true,
        is_selectable: true,
        is_selected: true,
        is_active: true,
      },
    ])
  })
})
