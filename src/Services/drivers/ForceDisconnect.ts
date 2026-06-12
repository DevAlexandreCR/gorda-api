import ActiveVehicleAssignmentRepository from '../../Repositories/ActiveVehicleAssignmentRepository'
import DriverTokenRecordRepository from '../../Repositories/DriverTokenRecordRepository'
import DatabaseService from '../firebase/Database'
import FCM from '../firebase/FCM'

const driverTokenRepo = new DriverTokenRecordRepository()

/**
 * Forcibly disconnects a driver from their active vehicle assignment:
 * 1. Deletes the active_vehicle_assignments row for the driver.
 * 2. Removes the driver from the RTDB online_drivers node.
 * 3. Sends a data-only FCM message with type=force_disconnect and the given reason.
 */
export async function forceDisconnect(driverId: string, reason: string): Promise<void> {
  await ActiveVehicleAssignmentRepository.releaseByDriver(driverId)

  await DatabaseService.dbConnectedDrivers().child(driverId).remove()

  const tokenRecord = await driverTokenRepo.findByDriverId(driverId)
  if (tokenRecord?.token) {
    await FCM.sendNotificationTo(tokenRecord.token, {
      title: '',
      body: '',
      data: { type: 'force_disconnect', reason },
    })
  }

  console.log(JSON.stringify({ metric: 'force_disconnect', driverId, reason }))
}
