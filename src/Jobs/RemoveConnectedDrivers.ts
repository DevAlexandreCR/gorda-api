import DriverRepository from '../Repositories/DriverRepository'
import {DriverUpdates} from '../Interfaces/DriversUpdates'
import config from '../../config'
import dayjs from 'dayjs'

export class RemoveConnectedDrivers {
	
	lastUpdates: DriverUpdates = {}
	
	public execute(): void {
		DriverRepository.onDriverLocationChanged((lastUpdated) => {
			this.lastUpdates[lastUpdated.driverId] = lastUpdated.timestamp
		})
		
		setInterval(() => {
			const currentTime: number = dayjs().tz('America/Bogota').unix()
			const inactiveThreshold: number = currentTime - 900
			Object.entries(this.lastUpdates).forEach(([driverId, lastUpdated]: [string, number]) => {
				if (lastUpdated < inactiveThreshold) {
					DriverRepository.removeDriver(driverId).then(() => {
						delete this.lastUpdates[driverId]
					})
				}
			})
		}, config.DISCONNECT_TIMEOUT as number)
	}
}