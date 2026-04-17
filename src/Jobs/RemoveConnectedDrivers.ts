import DriverRepository from '../Repositories/DriverRepository'
import { DriverUpdates } from '../Interfaces/DriversUpdates'
import config from '../../config'
import dayjs from 'dayjs'

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

    DriverRepository.watchConnectedDrivers((lastUpdated) => {
      this.lastUpdates[lastUpdated.driverId] = {
        observedAt: lastUpdated.timestamp,
        lastSeenAt: lastUpdated.lastSeenAt,
      }
    })

    setInterval(() => {
      const currentTime: number = dayjs().tz('America/Bogota').unix()
      const staleThreshold: number =
        currentTime - (Number.parseInt(String(config.DRIVER_STALE_SECONDS || '180'), 10) || 180)

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
          DriverRepository.removeDriver(driverId).then(() => {
            console.log(
              JSON.stringify({
                event: 'heartbeat_timeout_cleanup_completed',
                driverId,
              })
            )
            delete this.lastUpdates[driverId]
          })
        }
      })
    }, config.DISCONNECT_TIMEOUT as number)
  }
}
