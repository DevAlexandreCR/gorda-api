import Database from '../Services/firebase/Database'
import {ServiceInterface} from '../Interfaces/ServiceInterface'
import {DataSnapshot} from 'firebase-admin/database'
import Service from '../Models/Service'

class WpNotificationRepository {
	
	public async deleteNotification(notification: string, key: string): Promise<void> {
		await Database.dbWpNotifications()
			.child(notification)
			.child(key)
			.remove()
	}
	
  public async onServiceAssigned(onAssigned: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('assigned')
    .orderByKey()
    .limitToLast(1)
    .on('child_added', onAssigned)
  }

  public async onServiceCanceled(onCanceled: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('canceled')
    .orderByKey()
    .limitToLast(1)
    .on('child_added', onCanceled)
  }

  public async onServiceTerminated(onTerminated: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('completed')
    .orderByKey()
    .limitToLast(1)
    .on('child_added', onTerminated)
  }

  public async onDriverArrived(onArrived: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('arrived')
    .orderByKey()
    .limitToLast(1)
    .on('child_added', onArrived)
  }
}

export default new WpNotificationRepository()