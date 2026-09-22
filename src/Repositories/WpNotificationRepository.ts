import Database from '../Services/firebase/Database'
import { DataSnapshot, Query } from 'firebase-admin/database'

class WpNotificationRepository {
  private notificationQuery(kind: string, wpClient: string): Query {
    return Database.dbWpNotifications()
      .child(kind)
      .orderByChild('wp_client_id')
      .equalTo(wpClient)
      .limitToLast(3)
  }

  public async deleteNotification(notification: string, key: string): Promise<void> {
    await Database.dbWpNotifications().child(notification).child(key).remove()
  }

  public onServiceAssigned(wpClient: string, onAssigned: (data: DataSnapshot) => void): void {
    this.notificationQuery('assigned', wpClient).on('child_added', onAssigned)
  }

  public onServiceCanceled(wpClient: string, onCanceled: (data: DataSnapshot) => void): void {
    this.notificationQuery('canceled', wpClient).on('child_added', onCanceled)
  }

  public onServiceTerminated(wpClient: string, onTerminated: (data: DataSnapshot) => void): void {
    this.notificationQuery('terminated', wpClient).on('child_added', onTerminated)
  }

  public onNewService(wpClient: string, onNew: (data: DataSnapshot) => void): void {
    this.notificationQuery('new', wpClient).on('child_added', onNew)
  }

  public onDriverArrived(wpClient: string, onArrived: (data: DataSnapshot) => void): void {
    this.notificationQuery('arrived', wpClient).on('child_added', onArrived)
  }

  public offNotifications(wpClient: string): void {
    this.notificationQuery('arrived', wpClient).off()
    this.notificationQuery('new', wpClient).off()
    this.notificationQuery('terminated', wpClient).off()
    this.notificationQuery('canceled', wpClient).off()
    this.notificationQuery('assigned', wpClient).off()
  }
}

export default new WpNotificationRepository()
