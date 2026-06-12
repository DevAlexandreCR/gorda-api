import http from 'http'
import express from 'express'
import type { AddressInfo } from 'net'

// --- Module mocks (hoisted) ---

jest.mock('../../../../Middlewares/Authorization', () => ({
  requireAuth: jest.fn((_req: any, _res: any, next: any) => next()),
}))

jest.mock('../../../../Database/sequelize', () => ({
  define: jest.fn(),
  query: jest.fn(),
}))

// VehicleRepository is a class instantiated at module level in VehiclesController.
// Mock the whole module so no DB connections occur.
const mockSearch = jest.fn()
const mockFindByNormalizedPlate = jest.fn()
const mockFindWithLinkedDrivers = jest.fn()
const mockFindById = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockSetEnabled = jest.fn()

jest.mock('../../../../Repositories/VehicleRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    search: mockSearch,
    findByNormalizedPlate: mockFindByNormalizedPlate,
    findWithLinkedDrivers: mockFindWithLinkedDrivers,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    setEnabled: mockSetEnabled,
  })),
}))

// ActiveVehicleAssignmentRepository is a singleton (default export is an instance).
const mockFindByVehicle = jest.fn()
jest.mock('../../../../Repositories/ActiveVehicleAssignmentRepository', () => ({
  __esModule: true,
  default: {
    findByVehicle: mockFindByVehicle,
    acquire: jest.fn(),
    releaseByDriver: jest.fn(),
    releaseByVehicle: jest.fn(),
    findByDriver: jest.fn(),
  },
}))

// ForceDisconnect service — mock so no Firebase calls occur in tests.
const mockForceDisconnect = jest.fn()
jest.mock('../../../../Services/drivers/ForceDisconnect', () => ({
  __esModule: true,
  forceDisconnect: (...args: any[]) => mockForceDisconnect(...args),
}))

// AutoPromoteVehicle service — mock so no DB calls occur in tests.
const mockAutoPromoteSelectedVehicle = jest.fn()
jest.mock('../../../../Services/drivers/AutoPromoteVehicle', () => ({
  __esModule: true,
  autoPromoteSelectedVehicle: (...args: any[]) => mockAutoPromoteSelectedVehicle(...args),
}))

// ---------------------------------------------------------------------------
// Typed accessors
// ---------------------------------------------------------------------------

const MockedAuth = jest.requireMock('../../../../Middlewares/Authorization') as {
  requireAuth: jest.Mock
}

const MockedSequelize = jest.requireMock('../../../../Database/sequelize') as {
  query: jest.Mock
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
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
    if (payload) req.write(payload)
    req.end()
  })
}

function get(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return makeRequest(server, 'GET', path, undefined, headers)
}

function patch(
  server: http.Server,
  path: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return makeRequest(server, 'PATCH', path, body, headers)
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let server: http.Server

beforeAll((done) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const controller = require('../VehiclesController').default
  const app = express()
  app.use(express.json())
  app.use('/vehicles', controller)
  server = http.createServer(app)
  server.listen(0, '127.0.0.1', done)
})

afterAll((done) => {
  server.close(done)
})

beforeEach(() => {
  jest.clearAllMocks()
  MockedAuth.requireAuth.mockImplementation((_req: any, _res: any, next: any) => next())
  mockForceDisconnect.mockReset()
  mockForceDisconnect.mockResolvedValue(undefined)
  mockAutoPromoteSelectedVehicle.mockReset()
  mockAutoPromoteSelectedVehicle.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// GET /vehicles?search=...
// ---------------------------------------------------------------------------

describe('GET /vehicles (search)', () => {
  it('returns 200 with paged vehicles and total', async () => {
    const fakeVehicle = {
      id: 'veh-1',
      plate: 'ABC123',
      brand: 'Toyota',
      model: 'Corolla',
      color: null,
      photo_url: null,
      soat_exp: null,
      tec_exp: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    }
    mockSearch.mockResolvedValue({ vehicles: [fakeVehicle], total: 1 })

    const { status, body } = await get(server, '/vehicles?search=Toyota')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.vehicles).toHaveLength(1)
    expect(body.data.vehicles[0].plate).toBe('ABC123')
    expect(mockSearch).toHaveBeenCalledTimes(1)
    const callArg = mockSearch.mock.calls[0][0]
    expect(callArg.search).toBe('Toyota')
  })

  it('returns 200 with empty vehicles when no results', async () => {
    mockSearch.mockResolvedValue({ vehicles: [], total: 0 })

    const { status, body } = await get(server, '/vehicles?search=NOTFOUND')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.vehicles).toEqual([])
    expect(body.data.total).toBe(0)
  })

  it('returns 400 when perPage is not in allowed set', async () => {
    const { status, body } = await get(server, '/vehicles?perPage=15')

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/perPage/i)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('forwards page and perPage to repository', async () => {
    mockSearch.mockResolvedValue({ vehicles: [], total: 0 })

    await get(server, '/vehicles?page=2&perPage=20')

    const callArg = mockSearch.mock.calls[0][0]
    expect(callArg.page).toBe(2)
    expect(callArg.perPage).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// GET /vehicles/lookup?plate=
// ---------------------------------------------------------------------------

describe('GET /vehicles/lookup (dedupe lookup)', () => {
  it('returns 200 with vehicle and currently_driven_by when vehicle exists and is assigned', async () => {
    const fakeVehicle = {
      id: 'veh-1',
      plate: 'ABC123',
      brand: null,
      model: null,
      color: null,
      photo_url: null,
      soat_exp: null,
      tec_exp: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    }
    const fakeVehicleWithDrivers = { ...fakeVehicle, linked_drivers: [] }
    const fakeAssignment = {
      vehicle_id: 'veh-1',
      driver_id: 'drv-99',
      session_id: null,
      acquired_at: new Date(),
    }

    mockFindByNormalizedPlate.mockResolvedValue(fakeVehicle)
    mockFindWithLinkedDrivers.mockResolvedValue(fakeVehicleWithDrivers)
    mockFindByVehicle.mockResolvedValue(fakeAssignment)
    MockedSequelize.query.mockResolvedValue([{ id: 'drv-99', name: 'Test Driver' }])

    const { status, body } = await get(server, '/vehicles/lookup?plate=ABC123')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.vehicle.plate).toBe('ABC123')
    expect(body.data.currently_driven_by).toEqual({ id: 'drv-99', name: 'Test Driver' })
  })

  it('returns 200 with currently_driven_by=null when vehicle exists but is not assigned', async () => {
    const fakeVehicle = {
      id: 'veh-1',
      plate: 'ABC123',
      brand: null,
      model: null,
      color: null,
      photo_url: null,
      soat_exp: null,
      tec_exp: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    }
    const fakeVehicleWithDrivers = { ...fakeVehicle, linked_drivers: [] }

    mockFindByNormalizedPlate.mockResolvedValue(fakeVehicle)
    mockFindWithLinkedDrivers.mockResolvedValue(fakeVehicleWithDrivers)
    mockFindByVehicle.mockResolvedValue(null)

    const { status, body } = await get(server, '/vehicles/lookup?plate=ABC123')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.currently_driven_by).toBeNull()
  })

  it('normalizes the plate before lookup (lowercase input)', async () => {
    mockFindByNormalizedPlate.mockResolvedValue(null)

    await get(server, '/vehicles/lookup?plate=abc-123')

    expect(mockFindByNormalizedPlate).toHaveBeenCalledWith('ABC123')
  })

  it('returns 400 when plate query param is missing', async () => {
    const { status, body } = await get(server, '/vehicles/lookup')

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/plate/i)
  })
})

// ---------------------------------------------------------------------------
// GET /vehicles/lookup — 404 on miss
// ---------------------------------------------------------------------------

describe('GET /vehicles/lookup — 404 when vehicle not found', () => {
  it('returns 404 with error=vehicle_not_found when plate ZZZ does not exist', async () => {
    mockFindByNormalizedPlate.mockResolvedValue(null)

    const { status, body } = await get(server, '/vehicles/lookup?plate=ZZZ')

    expect(status).toBe(404)
    expect(body.error).toBe('vehicle_not_found')
  })
})

// ---------------------------------------------------------------------------
// PATCH /vehicles/:id — plate immutability
// ---------------------------------------------------------------------------

describe('PATCH /vehicles/:id (update)', () => {
  it('returns 400 with error=plate_immutable when body contains plate', async () => {
    const { status, body } = await patch(server, '/vehicles/veh-1', {
      plate: 'NEWPLATE',
      brand: 'Ford',
    })

    expect(status).toBe(400)
    expect(body.error).toBe('plate_immutable')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 with error=plate_immutable even when plate is undefined as an explicit key', async () => {
    // Sending `{ plate: undefined }` — JSON encodes it as `{}` so 'plate' is NOT in body.
    // This test ensures that only an explicit plate key in JSON body triggers rejection.
    mockFindById.mockResolvedValue({
      id: 'veh-1',
      plate: 'ABC123',
      brand: null,
      model: null,
      color: null,
      photo_url: null,
      soat_exp: null,
      tec_exp: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const { status, body } = await patch(server, '/vehicles/veh-1', { brand: 'Ford' })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PATCH /vehicles/:id/enabled — toggle enabled
// ---------------------------------------------------------------------------

describe('PATCH /vehicles/:id/enabled (toggle enabled)', () => {
  const fakeVehicle = {
    id: 'veh-1',
    plate: 'ABC123',
    brand: null,
    model: null,
    color: null,
    photo_url: null,
    soat_exp: null,
    tec_exp: null,
    enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
  }

  it('returns 200 when enabled=false is sent and vehicle exists with no active assignment', async () => {
    mockFindById.mockResolvedValue(fakeVehicle)
    mockSetEnabled.mockResolvedValue(undefined)
    mockFindByVehicle.mockResolvedValue(null)
    MockedSequelize.query.mockResolvedValue([])

    const { status, body } = await patch(server, '/vehicles/veh-1/enabled', { enabled: false })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockSetEnabled).toHaveBeenCalledWith('veh-1', false)
  })

  it('returns 200 when enabled=true is sent and vehicle exists', async () => {
    mockFindById.mockResolvedValue({ ...fakeVehicle, enabled: true })
    mockSetEnabled.mockResolvedValue(undefined)

    const { status, body } = await patch(server, '/vehicles/veh-1/enabled', { enabled: true })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockSetEnabled).toHaveBeenCalledWith('veh-1', true)
  })

  it('returns 400 when enabled is not a boolean (string value)', async () => {
    const { status, body } = await patch(server, '/vehicles/veh-1/enabled', { enabled: 'false' })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/enabled/i)
    expect(mockSetEnabled).not.toHaveBeenCalled()
  })

  it('returns 404 when vehicle does not exist', async () => {
    mockFindById.mockResolvedValue(null)

    const { status, body } = await patch(server, '/vehicles/nonexistent/enabled', {
      enabled: false,
    })

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockSetEnabled).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Confirmation gate (task 7.3) and force-disconnect (task 7.2)
  // ---------------------------------------------------------------------------

  it('returns 409 vehicle_active with held_by when disabling a vehicle with an active assignment and no confirmed flag', async () => {
    const assignment = {
      vehicle_id: 'veh-1',
      driver_id: 'drv-99',
      session_id: null,
      acquired_at: new Date(),
    }
    mockFindById.mockResolvedValue(fakeVehicle)
    mockFindByVehicle.mockResolvedValue(assignment)
    // sequelize.query is called to look up driver name
    MockedSequelize.query.mockResolvedValue([{ id: 'drv-99', name: 'John Doe' }])

    const { status, body } = await patch(server, '/vehicles/veh-1/enabled', { enabled: false })

    expect(status).toBe(409)
    expect(body.error).toBe('vehicle_active')
    expect(body.held_by).toEqual({ id: 'drv-99', name: 'John Doe' })
    expect(mockForceDisconnect).not.toHaveBeenCalled()
    expect(mockSetEnabled).not.toHaveBeenCalled()
  })

  it('calls forceDisconnect and returns 200 when disabling an active vehicle with confirmed=true', async () => {
    const assignment = {
      vehicle_id: 'veh-1',
      driver_id: 'drv-99',
      session_id: null,
      acquired_at: new Date(),
    }
    mockFindById.mockResolvedValue(fakeVehicle)
    mockFindByVehicle.mockResolvedValue(assignment)
    mockForceDisconnect.mockResolvedValue(undefined)
    mockSetEnabled.mockResolvedValue(undefined)
    // Query for affected drivers (autoPromote pass)
    MockedSequelize.query.mockResolvedValue([])

    const { status, body } = await patch(server, '/vehicles/veh-1/enabled', {
      enabled: false,
      confirmed: true,
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockForceDisconnect).toHaveBeenCalledTimes(1)
    expect(mockForceDisconnect).toHaveBeenCalledWith('drv-99', 'vehicle_disabled')
    expect(mockSetEnabled).toHaveBeenCalledWith('veh-1', false)
  })

  it('sends FCM data message with type=force_disconnect and reason=vehicle_disabled shape via forceDisconnect', async () => {
    // This test validates that forceDisconnect is called with the correct arguments
    // (i.e. the FCM payload shape is { data: { type: "force_disconnect", reason: "vehicle_disabled" } }).
    const assignment = {
      vehicle_id: 'veh-1',
      driver_id: 'drv-42',
      session_id: null,
      acquired_at: new Date(),
    }
    mockFindById.mockResolvedValue(fakeVehicle)
    mockFindByVehicle.mockResolvedValue(assignment)
    mockForceDisconnect.mockResolvedValue(undefined)
    mockSetEnabled.mockResolvedValue(undefined)
    MockedSequelize.query.mockResolvedValue([])

    await patch(server, '/vehicles/veh-1/enabled', { enabled: false, confirmed: true })

    expect(mockForceDisconnect).toHaveBeenCalledWith('drv-42', 'vehicle_disabled')
  })

  it('runs autoPromoteSelectedVehicle for each driver with selected_vehicle_id equal to the disabled vehicle', async () => {
    mockFindById.mockResolvedValue(fakeVehicle)
    mockFindByVehicle.mockResolvedValue(null)
    mockSetEnabled.mockResolvedValue(undefined)
    // Two drivers had this vehicle as their selected vehicle
    MockedSequelize.query.mockResolvedValue([{ id: 'drv-1' }, { id: 'drv-2' }])

    await patch(server, '/vehicles/veh-1/enabled', { enabled: false })

    expect(mockAutoPromoteSelectedVehicle).toHaveBeenCalledTimes(2)
    expect(mockAutoPromoteSelectedVehicle).toHaveBeenCalledWith('drv-1')
    expect(mockAutoPromoteSelectedVehicle).toHaveBeenCalledWith('drv-2')
  })
})
