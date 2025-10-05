import DBService from '../Services/firebase/Database'
import { DriverInterface } from '../Interfaces/DriverInterface'
import Driver from '../Models/Driver'
import { DataSnapshot } from 'firebase-admin/lib/database'
import Database from '../Services/firebase/Database'
import { LastUpdated } from '../Interfaces/LastUpdated'
import dayjs from 'dayjs'

class DriverRepository {
  /* istanbul ignore next */
  async getDriver(id: string): Promise<DriverInterface> {
    const snapshot: DataSnapshot = await Database.dbDrivers().child(id).once('value')
    return <DriverInterface>snapshot.val() ?? new Driver()
  }

  /* istanbul ignore next */
  getAll(listener: (driver: Driver) => void): void {
    DBService.dbDrivers().on('child_added', (snapshot) => {
      const driver = snapshot.val() as DriverInterface
      const driverTmp = new Driver()
      Object.assign(driverTmp, driver)
      listener(driverTmp)
    })
  }

  /* istanbul ignore next */
  updateDriver(listener: (driver: Driver) => void): void {
    DBService.dbDrivers().on('child_changed', (snapshot) => {
      const driver = snapshot.val() as DriverInterface
      const driverTmp = new Driver()
      Object.assign(driverTmp, driver)
      listener(driverTmp)
    })
  }

  onDriverLocationChanged(listener: (lastUpdated: LastUpdated) => void): void {
    DBService.dbConnectedDrivers().on('child_changed', (snapshot) => {
      const value = snapshot.val()
      const lastUpdated: LastUpdated = {
        driverId: value.id,
        timestamp: dayjs().tz('America/Bogota').unix(),
      }
      listener(lastUpdated)
    })
  }

  removeDriver(driverId: string): Promise<void> {
    return DBService.dbConnectedDrivers().child(driverId).remove()
  }

  getToken(driverId: string): Promise<string | null> {
    return DBService.dbTokens()
      .child(driverId)
      .once('value')
      .then((snapshot) => {
        const token = snapshot.val()
        return token ? token : null
      })
      .catch((error) => {
        console.error('Error fetching driver token:', error)
        return null
      })
  }
}

export default new DriverRepository()
