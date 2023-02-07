import Database from '../Services/firebase/Database'
import {ServiceInterface} from '../Interfaces/ServiceInterface'
import {DataSnapshot} from 'firebase-admin/database'

class ServiceRepository {
  
  public async findServiceById(serviceId: string): Promise<ServiceInterface> {
    return new Promise((resolve, reject) => {
    Database.dbServices().child(serviceId).orderByKey()
      .once('value', (snapshot) => {
        if (snapshot.exists()) resolve(<ServiceInterface>snapshot.val())
        else reject(new Error('not exist'))
      }, (e) => {
        reject(e)
      })
    })
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
    await Database.dbServices().orderByChild('status').limitToLast(100).on('child_changed', onChanged)
  }
}

export default new ServiceRepository()