import cron from 'node-cron'
import {populateMetrics} from './PopulateMetrics'

class Schedule {
  execute(): void {
		cron.schedule('10 0 * * *', populateMetrics)
  }
}

export default new Schedule()
