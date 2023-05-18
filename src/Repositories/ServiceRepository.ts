import Database from '../Services/firebase/Database'
import {ServiceInterface} from '../Interfaces/ServiceInterface'

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
	
	public async findServiceStatusById(serviceId: string): Promise<string> {
		return new Promise((resolve, reject) => {
			Database.dbServices().child(serviceId).child('status')
				.once('value', (snapshot) => {
					if (snapshot.exists()) resolve(<string>snapshot.val())
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
}

export default new ServiceRepository()