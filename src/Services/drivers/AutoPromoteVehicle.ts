import { Transaction } from 'sequelize'
import DriverVehicleRepository from '../../Repositories/DriverVehicleRepository'
import DriverRecord from '../../Models/DriverRecord'

const driverVehicleRepo = new DriverVehicleRepository()

/**
 * Picks the most recent eligible link (selectable=true, vehicle.enabled=true)
 * and updates drivers.selected_vehicle_id accordingly.
 * If no eligible link exists, sets selected_vehicle_id to NULL.
 */
export async function autoPromoteSelectedVehicle(
  driverId: string,
  txn?: Transaction
): Promise<void> {
  const eligible = await driverVehicleRepo.findMostRecentEligible(driverId)
  const newVehicleId = eligible ? eligible.vehicle_id : null

  await DriverRecord.update({ selected_vehicle_id: newVehicleId } as any, {
    where: { id: driverId },
    transaction: txn,
  })

  console.log(
    JSON.stringify({
      metric: 'auto_promote',
      driverId,
      outcome: newVehicleId ? 'promoted' : 'cleared',
      vehicleId: newVehicleId ?? null,
    })
  )
}
