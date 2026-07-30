import DriverRepository from '../Repositories/DriverRepository'
import ActiveVehicleAssignmentRepository from '../Repositories/ActiveVehicleAssignmentRepository'
import { DriverUpdates } from '../Interfaces/DriversUpdates'
import config from '../../config'

export class RemoveConnectedDrivers {
  lastUpdates: DriverUpdates = {}

  public execute(): void {
    DriverRepository.seedConnectedDrivers((lastUpdated) => {
      this.lastUpdates[lastUpdated.driverId] = {
        observedAt: lastUpdated.timestamp,
        lastSeenAt: lastUpdated.lastSeenAt,
      }
    }).catch((error) => {
      console.error(
        JSON.stringify({
          event: 'seed_connected_drivers_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      )
    })

    DriverRepository.watchConnectedDrivers(
      (lastUpdated) => {
        this.lastUpdates[lastUpdated.driverId] = {
          observedAt: lastUpdated.timestamp,
          lastSeenAt: lastUpdated.lastSeenAt,
        }
      },
      (driverId) => {
        // Purges the tracker for ANY node removal (disconnect, force-disconnect,
        // or eviction) so a driver who left cleanly is never phantom-evicted later.
        delete this.lastUpdates[driverId]
      }
    )

    setInterval(() => {
      const driverStaleSeconds =
        Number.parseInt(String(config.DRIVER_STALE_SECONDS || '180'), 10) || 180
      const staleThreshold: number = Date.now() - driverStaleSeconds * 1000

      Object.entries(this.lastUpdates).forEach(([driverId, lastUpdated]) => {
        const effectiveLastSeenAt = lastUpdated.lastSeenAt ?? lastUpdated.observedAt
        if (effectiveLastSeenAt < staleThreshold) {
          console.log(
            JSON.stringify({
              event: 'heartbeat_timeout',
              driverId,
              effectiveLastSeenAt,
              observedAt: lastUpdated.observedAt,
              staleThreshold,
            })
          )
          // Silent eviction: no ForceDisconnect call, no FCM push (design Decision 3).
          // The RTDB removal re-reads the live node and aborts as a no-op if it is
          // already absent or fresh, so concurrent sweeps race-lose harmlessly and
          // the mutex is only released by the process that actually removed the node.
          DriverRepository.removeIfStale(driverId, staleThreshold)
            .then(async (removed) => {
              delete this.lastUpdates[driverId]

              if (!removed) return

              await ActiveVehicleAssignmentRepository.releaseByDriver(driverId)

              console.log(
                JSON.stringify({
                  event: 'heartbeat_timeout_cleanup_completed',
                  driverId,
                })
              )
            })
            .catch((error) => {
              console.error(
                JSON.stringify({
                  event: 'heartbeat_timeout_cleanup_failed',
                  driverId,
                  error: error instanceof Error ? error.message : String(error),
                })
              )
            })
        }
      })
    }, config.PRESENCE_SWEEP_INTERVAL_MS as number)
  }
}
