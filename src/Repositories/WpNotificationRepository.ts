import Database from '../Services/firebase/Database'
import {DataSnapshot} from 'firebase-admin/database'

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
    .limitToLast(3)
    .on('child_added', onAssigned)
  }

  public async onServiceCanceled(onCanceled: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('canceled')
    .orderByKey()
    .limitToLast(3)
    .on('child_added', onCanceled)
  }

  public async onServiceTerminated(onTerminated: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('terminated')
    .orderByKey()
    .limitToLast(3)
    .on('child_added', onTerminated)
  }
	
	public async onNewService(onNew: (data: DataSnapshot) => void): Promise<void> {
		await Database.dbWpNotifications()
			.child('new')
			.orderByKey()
			.limitToLast(3)
			.on('child_added', onNew)
	}

  public async onDriverArrived(onArrived: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('arrived')
    .orderByKey()
    .limitToLast(3)
    .on('child_added', onArrived)
  }
}

export default new WpNotificationRepository()