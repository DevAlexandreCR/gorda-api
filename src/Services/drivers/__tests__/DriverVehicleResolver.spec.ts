// ActiveVehicleAssignmentRepository — singleton default export
const mockFindByDriver = jest.fn()
jest.mock('../../../Repositories/ActiveVehicleAssignmentRepository', () => ({
  __esModule: true,
  default: {
    findByDriver: mockFindByDriver,
    findByVehicle: jest.fn(),
    acquire: jest.fn(),
    releaseByDriver: jest.fn(),
    releaseByVehicle: jest.fn(),
  },
}))

// VehicleRepository — class instantiated at module-level in DriverVehicleResolver
const mockFindById = jest.fn()
jest.mock('../../../Repositories/VehicleRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
    findByNormalizedPlate: jest.fn(),
    findOrCreateByPlate: jest.fn(),
    search: jest.fn(),
    findWithLinkedDrivers: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setEnabled: jest.fn(),
  })),
}))

// DriverRecord — Sequelize Model used directly in DriverVehicleResolver
const mockDriverRecordFindByPk = jest.fn()
jest.mock('../../../Models/DriverRecord', () => ({
  __esModule: true,
  default: {
    findByPk: mockDriverRecordFindByPk,
    update: jest.fn(),
  },
  setupDriverAssociations: jest.fn(),
}))

import { resolveDriverCurrentVehicle } from '../DriverVehicleResolver'
import { VehicleRecordInterface } from '../../../Interfaces/VehicleRecordInterface'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVehicle(overrides: Partial<VehicleRecordInterface> = {}): VehicleRecordInterface {
  return {
    id: 'veh-uuid-1',
    plate: 'ABC123',
    brand: 'Toyota',
    model: 'Yaris',
    color: { name: 'White', hex: '#FFFFFF' },
    photoUrl: null,
    soat_exp: null,
    tec_exp: null,
    enabled: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeAssignment(vehicleId: string, driverId: string) {
  return {
    vehicle_id: vehicleId,
    driver_id: driverId,
    session_id: null,
    acquired_at: new Date(),
  }
}

function makeDriverRecord(selectedVehicleId: string | null) {
  return {
    get: (_opts: any) => ({ selected_vehicle_id: selectedVehicleId }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveDriverCurrentVehicle', () => {
  describe('returns null for falsy driverId without hitting repositories', () => {
    it('returns null for null driverId', async () => {
      const result = await resolveDriverCurrentVehicle(null)

      expect(result).toBeNull()
      expect(mockFindByDriver).not.toHaveBeenCalled()
      expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
      expect(mockFindById).not.toHaveBeenCalled()
    })

    it('returns null for empty string driverId', async () => {
      const result = await resolveDriverCurrentVehicle('')

      expect(result).toBeNull()
      expect(mockFindByDriver).not.toHaveBeenCalled()
      expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
      expect(mockFindById).not.toHaveBeenCalled()
    })

    it('returns null for whitespace-only driverId', async () => {
      const result = await resolveDriverCurrentVehicle('   ')

      expect(result).toBeNull()
      expect(mockFindByDriver).not.toHaveBeenCalled()
      expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
      expect(mockFindById).not.toHaveBeenCalled()
    })

    it('returns null for undefined driverId', async () => {
      const result = await resolveDriverCurrentVehicle(undefined)

      expect(result).toBeNull()
      expect(mockFindByDriver).not.toHaveBeenCalled()
    })
  })

  describe('active assignment wins', () => {
    it('returns the vehicle from the active assignment and does not fall through to selected-vehicle path', async () => {
      const driverId = 'drv-1'
      const vehicleId = 'veh-active-1'
      const expectedVehicle = makeVehicle({
        id: vehicleId,
        plate: 'ACT001',
        color: { name: 'Blue', hex: '#0000FF' },
      })

      mockFindByDriver.mockResolvedValue(makeAssignment(vehicleId, driverId))
      mockFindById.mockResolvedValue(expectedVehicle)

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toEqual(expectedVehicle)
      expect(mockFindByDriver).toHaveBeenCalledWith(driverId)
      expect(mockFindById).toHaveBeenCalledWith(vehicleId)
      // selected-vehicle fallback path must not be reached
      expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
    })

    it('passes color: null through untouched when the active vehicle has null color', async () => {
      const driverId = 'drv-2'
      const vehicleId = 'veh-null-color'
      const vehicleWithNullColor = makeVehicle({ id: vehicleId, color: null })

      mockFindByDriver.mockResolvedValue(makeAssignment(vehicleId, driverId))
      mockFindById.mockResolvedValue(vehicleWithNullColor)

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).not.toBeNull()
      expect(result!.color).toBeNull()
      expect(mockDriverRecordFindByPk).not.toHaveBeenCalled()
    })
  })

  describe('selected-vehicle fallback (no active assignment)', () => {
    it('returns the selected vehicle when no active assignment exists', async () => {
      const driverId = 'drv-3'
      const selectedVehicleId = 'veh-selected-1'
      const selectedVehicle = makeVehicle({ id: selectedVehicleId, plate: 'SEL001' })

      mockFindByDriver.mockResolvedValue(null)
      mockDriverRecordFindByPk.mockResolvedValue(makeDriverRecord(selectedVehicleId))
      mockFindById.mockResolvedValue(selectedVehicle)

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toEqual(selectedVehicle)
      expect(mockFindByDriver).toHaveBeenCalledWith(driverId)
      expect(mockDriverRecordFindByPk).toHaveBeenCalledWith(driverId)
      expect(mockFindById).toHaveBeenCalledWith(selectedVehicleId)
    })
  })

  describe('orphaned active FK: active assignment exists but vehicle does not resolve', () => {
    it('falls through to selected-vehicle path when active assignment vehicle is not found', async () => {
      const driverId = 'drv-4'
      const orphanedVehicleId = 'veh-orphaned'
      const selectedVehicleId = 'veh-selected-2'
      const selectedVehicle = makeVehicle({ id: selectedVehicleId, plate: 'SEL002' })

      mockFindByDriver.mockResolvedValue(makeAssignment(orphanedVehicleId, driverId))
      // active assignment vehicle not found (orphaned FK)
      mockFindById
        .mockResolvedValueOnce(null) // findById(orphanedVehicleId) → null
        .mockResolvedValueOnce(selectedVehicle) // findById(selectedVehicleId) → vehicle
      mockDriverRecordFindByPk.mockResolvedValue(makeDriverRecord(selectedVehicleId))

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toEqual(selectedVehicle)
      expect(mockFindById).toHaveBeenNthCalledWith(1, orphanedVehicleId)
      expect(mockDriverRecordFindByPk).toHaveBeenCalledWith(driverId)
      expect(mockFindById).toHaveBeenNthCalledWith(2, selectedVehicleId)
    })
  })

  describe('returns null when nothing resolves', () => {
    it('returns null when no active assignment and driver record is not found', async () => {
      const driverId = 'drv-5'

      mockFindByDriver.mockResolvedValue(null)
      mockDriverRecordFindByPk.mockResolvedValue(null)

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toBeNull()
      expect(mockFindById).not.toHaveBeenCalled()
    })

    it('returns null when no active assignment and driver has no selected_vehicle_id', async () => {
      const driverId = 'drv-6'

      mockFindByDriver.mockResolvedValue(null)
      mockDriverRecordFindByPk.mockResolvedValue(makeDriverRecord(null))

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toBeNull()
      expect(mockFindById).not.toHaveBeenCalled()
    })

    it('returns null when no active assignment and selected vehicle is not found in repo', async () => {
      const driverId = 'drv-7'
      const selectedVehicleId = 'veh-missing'

      mockFindByDriver.mockResolvedValue(null)
      mockDriverRecordFindByPk.mockResolvedValue(makeDriverRecord(selectedVehicleId))
      mockFindById.mockResolvedValue(null)

      const result = await resolveDriverCurrentVehicle(driverId)

      expect(result).toBeNull()
      expect(mockFindById).toHaveBeenCalledWith(selectedVehicleId)
    })
  })
})
