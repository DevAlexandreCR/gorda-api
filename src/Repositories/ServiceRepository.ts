import Database from '../Services/firebase/Database'
import { ServiceInterface } from '../Interfaces/ServiceInterface'
import { DataSnapshot } from 'firebase-admin/lib/database'

class ServiceRepository {
  public async findServiceById(serviceId: string): Promise<ServiceInterface> {
    return new Promise((resolve, reject) => {
      Database.dbServices()
        .child(serviceId)
        .orderByKey()
        .once(
          'value',
          (snapshot) => {
            if (snapshot.exists()) resolve(<ServiceInterface>snapshot.val())
            else reject(new Error('not exist'))
          },
          (e) => {
            reject(e)
          }
        )
    })
  }

  public async findServiceStatusById(serviceId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      Database.dbServices()
        .child(serviceId)
        .child('status')
        .once(
          'value',
          (snapshot) => {
            if (snapshot.exists()) resolve(<string>snapshot.val())
            else reject(new Error('not exist'))
          },
          (e) => {
            reject(e)
          }
        )
    })
  }

  public async updateStatus(serviceId: string, status: string): Promise<void> {
    await Database.dbServices().child(serviceId).update({ status: status })
  }

  public async create(service: ServiceInterface): Promise<ServiceInterface> {
    const res = Database.dbServices().push()
    service.id = res.key
    await res.set(service)
    return service
  }

  public onServiceChanged(onChanged: (data: DataSnapshot) => void): void {
    Database.dbServices().orderByChild('created_at').limitToLast(100).on('child_changed', onChanged)
  }
}

export default new ServiceRepository()
