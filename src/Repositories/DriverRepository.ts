import DatabaseService from '../Services/firebase/Database'
import { LastUpdated } from '../Interfaces/LastUpdated'
import dayjs from 'dayjs'

class DriverRepository {
  onDriverLocationChanged(listener: (lastUpdated: LastUpdated) => void): void {
    DatabaseService.dbConnectedDrivers().on('child_changed', (snapshot) => {
      const value = snapshot.val()
      const lastUpdated: LastUpdated = {
        driverId: value.id,
        timestamp: dayjs().tz('America/Bogota').unix(),
      }
      listener(lastUpdated)
    })
  }

  removeDriver(driverId: string): Promise<void> {
    return DatabaseService.dbConnectedDrivers().child(driverId).remove()
  }
}

export default new DriverRepository()
