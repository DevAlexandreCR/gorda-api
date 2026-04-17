import DatabaseService from '../Services/firebase/Database'
import { LastUpdated } from '../Interfaces/LastUpdated'
import dayjs from 'dayjs'
import { DataSnapshot } from 'firebase-admin/database'

class DriverRepository {
  private buildLastUpdated(snapshot: DataSnapshot): LastUpdated | null {
    const value = snapshot.val()
    if (!value) return null

    const driverId = value.id ?? snapshot.key
    if (!driverId) return null

    const rawLastSeenAt = value.last_seen_at
    const parsedLastSeenAt =
      typeof rawLastSeenAt === 'number' && Number.isFinite(rawLastSeenAt) ? rawLastSeenAt : null

    return {
      driverId,
      timestamp: dayjs().tz('America/Bogota').unix(),
      lastSeenAt: parsedLastSeenAt,
    }
  }

  async seedConnectedDrivers(listener: (lastUpdated: LastUpdated) => void): Promise<void> {
    const snapshot = await DatabaseService.dbConnectedDrivers().get()

    snapshot.forEach((childSnapshot) => {
      const lastUpdated = this.buildLastUpdated(childSnapshot)
      if (lastUpdated) {
        listener(lastUpdated)
      }
    })
  }

  watchConnectedDrivers(listener: (lastUpdated: LastUpdated) => void): void {
    const emit = (snapshot: DataSnapshot): void => {
      const lastUpdated = this.buildLastUpdated(snapshot)
      if (lastUpdated) {
        listener(lastUpdated)
      }
    }

    DatabaseService.dbConnectedDrivers().on('child_added', emit)
    DatabaseService.dbConnectedDrivers().on('child_changed', emit)
  }

  removeDriver(driverId: string): Promise<void> {
    return DatabaseService.dbConnectedDrivers().child(driverId).remove()
  }
}

export default new DriverRepository()
