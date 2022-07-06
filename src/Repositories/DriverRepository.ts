import DBService from '../Services/firebase/Database'
import {DriverInterface} from '../Interfaces/DriverInterface'
import Driver from '../Models/Driver'
import {DataSnapshot} from 'firebase-admin/lib/database'
import Database from '../Services/firebase/Database'

class DriverRepository {
  
  /* istanbul ignore next */
  async getDriver(id: string): Promise<DriverInterface> {
    const snapshot: DataSnapshot = await Database.dbDrivers().child(id).once('value')
    return <DriverInterface>snapshot.val() ?? new Driver
  }
  
  /* istanbul ignore next */
  getAll(listener: (driver: Driver)=> void): void {
    DBService.dbDrivers().on('child_added', (snapshot) => {
      const driver = snapshot.val() as DriverInterface
      const driverTmp = new Driver()
      Object.assign(driverTmp, driver)
      listener(driverTmp)
    })
  }
}

export default new DriverRepository()