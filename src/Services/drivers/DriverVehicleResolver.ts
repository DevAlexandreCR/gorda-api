import ActiveVehicleAssignmentRepository from '../../Repositories/ActiveVehicleAssignmentRepository'
import VehicleRepository from '../../Repositories/VehicleRepository'
import DriverRecord from '../../Models/DriverRecord'
import { VehicleRecordInterface } from '../../Interfaces/VehicleRecordInterface'

const vehicleRepo = new VehicleRepository()

/**
 * Resolves the current vehicle for a driver by checking active assignments first,
 * then falling back to the driver's selected vehicle.
 *
 * Invariant: color is passed through as-is ({ name, hex? } | null); never default a null color
 * to an empty object — callers must handle null.
 */
export async function resolveDriverCurrentVehicle(
  driverId: string | null | undefined
): Promise<VehicleRecordInterface | null> {
  if (!driverId || !driverId.trim()) return null

  const assignment = await ActiveVehicleAssignmentRepository.findByDriver(driverId)
  if (assignment) {
    const vehicle = await vehicleRepo.findById(assignment.vehicle_id)
    if (vehicle) return vehicle
  }

  const driverRaw = await DriverRecord.findByPk(driverId)
  if (!driverRaw) return null

  const selectedVehicleId = (driverRaw.get({ plain: true }) as any)?.selected_vehicle_id ?? null
  if (!selectedVehicleId) return null

  const vehicle = await vehicleRepo.findById(selectedVehicleId)
  return vehicle ?? null
}
