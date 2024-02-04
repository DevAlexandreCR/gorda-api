import Database from '../Services/firebase/Database'
import {DataSnapshot} from 'firebase-admin/database'

class WpNotificationRepository {
	
	public async deleteNotification(notification: string, key: string): Promise<void> {
		await Database.dbWpNotifications()
			.child(notification)
			.child(key)
			.remove()
	}

  public async onServiceAssigned(wpClient: string, onAssigned: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('assigned')
    .orderByChild('wp_client_id')
    .equalTo(wpClient)
    .limitToLast(3)
    .on('child_added', onAssigned)
  }

  public async onServiceCanceled(wpClient: string, onCanceled: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('canceled')
    .orderByChild('wp_client_id')
    .equalTo(wpClient)
    .limitToLast(3)
    .on('child_added', onCanceled)
  }

  public async onServiceTerminated(wpClient: string, onTerminated: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('terminated')
    .orderByChild('wp_client_id')
    .equalTo(wpClient)
    .limitToLast(3)
    .on('child_added', onTerminated)
  }
	
	public async onNewService(wpClient: string, onNew: (data: DataSnapshot) => void): Promise<void> {
		await Database.dbWpNotifications()
			.child('new')
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
			.limitToLast(3)
			.on('child_added', onNew)
	}

  public async onDriverArrived(wpClient: string, onArrived: (data: DataSnapshot) => void): Promise<void> {
    await Database.dbWpNotifications()
    .child('arrived')
    .orderByChild('wp_client_id')
    .equalTo(wpClient)
    .limitToLast(3)
    .on('child_added', onArrived)
  }
}

export default new WpNotificationRepository()