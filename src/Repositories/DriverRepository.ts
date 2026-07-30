import DatabaseService from '../Services/firebase/Database'
import { LastUpdated } from '../Interfaces/LastUpdated'
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
      timestamp: Date.now(),
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

  watchConnectedDrivers(
    listener: (lastUpdated: LastUpdated) => void,
    onRemoved: (driverId: string) => void
  ): void {
    const emit = (snapshot: DataSnapshot): void => {
      const lastUpdated = this.buildLastUpdated(snapshot)
      if (lastUpdated) {
        listener(lastUpdated)
      }
    }

    DatabaseService.dbConnectedDrivers().on('child_added', emit)
    DatabaseService.dbConnectedDrivers().on('child_changed', emit)
    DatabaseService.dbConnectedDrivers().on('child_removed', (snapshot: DataSnapshot) => {
      const value = snapshot.val()
      const driverId = value?.id ?? snapshot.key
      if (driverId) {
        onRemoved(driverId)
      }
    })
  }

  removeDriver(driverId: string): Promise<void> {
    return DatabaseService.dbConnectedDrivers().child(driverId).remove()
  }

  // Removes online_drivers/{driverId} only if it is still absent-or-stale at the
  // time the transaction runs (re-reads the live value). Returning `null` from the
  // update function deletes the node; returning `undefined` aborts without writing.
  // This makes the eviction safe under concurrent sweeps (PM2 multi-instance): the
  // losing process's transaction aborts as a no-op against the already-removed node.
  async removeIfStale(driverId: string, staleThreshold: number): Promise<boolean> {
    const result = await DatabaseService.dbConnectedDrivers()
      .child(driverId)
      .transaction((current) => {
        if (!current) return undefined

        const lastSeenAt = current.last_seen_at
        const isFresh = typeof lastSeenAt === 'number' && lastSeenAt >= staleThreshold
        if (isFresh) return undefined

        return null
      })

    return result.committed
  }
}

export default new DriverRepository()
