import Database from '../Services/firebase/Database'
import {ServiceInterface} from '../Interfaces/ServiceInterface'
import {database} from 'firebase-admin'
import {DataSnapshot} from 'firebase-admin/database'

class ServiceRepository {
  
  public async findServiceById(serviceId: string): Promise<ServiceInterface> {
    const snapshot: database.DataSnapshot = await Database.dbServices().child(serviceId).once('value')
    return <ServiceInterface>snapshot.val()
  }
  
  public async update(service: ServiceInterface): Promise<ServiceInterface> {
    await Database.dbServices().child(service.id!).set(service)
    return service
  }
  
  public async create(service: ServiceInterface): Promise<ServiceInterface> {
    const res = await Database.dbServices().push(service)
    service.id = res.key!
    return this.update(service)
  }
  
  public async onServiceChanged(onChanged: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbServices().orderByChild('status').limitToLast(1000).on('child_changed', onChanged)
  }
}

export default new ServiceRepository()