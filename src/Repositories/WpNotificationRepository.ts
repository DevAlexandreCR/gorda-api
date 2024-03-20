import Database from '../Services/firebase/Database'
import {DataSnapshot} from 'firebase-admin/database'

class WpNotificationRepository {
	
	public async deleteNotification(notification: string, key: string): Promise<void> {
		await Database.dbWpNotifications()
			.child(notification)
			.child(key)
			.remove()
	}

  public onServiceAssigned(wpClient: string, onAssigned: (data: DataSnapshot) => void): void {
    Database.dbWpNotifications()
      .child('assigned')
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
      .limitToLast(3)
      .on('child_added', onAssigned)
  }

  public onServiceCanceled(wpClient: string, onCanceled: (data: DataSnapshot) => void): void {
    Database.dbWpNotifications()
      .child('canceled')
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
      .limitToLast(3)
      .on('child_added', onCanceled)
  }

  public onServiceTerminated(wpClient: string, onTerminated: (data: DataSnapshot) => void): void {
    Database.dbWpNotifications()
    .child('terminated')
    .orderByChild('wp_client_id')
    .equalTo(wpClient)
    .limitToLast(3)
    .on('child_added', onTerminated)
  }
	
	public onNewService(wpClient: string, onNew: (data: DataSnapshot) => void): void {
		Database.dbWpNotifications()
			.child('new')
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
			.limitToLast(3)
			.on('child_added', onNew)
	}

  public onDriverArrived(wpClient: string, onArrived: (data: DataSnapshot) => void): void {
    Database.dbWpNotifications()
      .child('arrived')
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
      .limitToLast(3)
      .on('child_added', onArrived)
  }
}

export default new WpNotificationRepository()