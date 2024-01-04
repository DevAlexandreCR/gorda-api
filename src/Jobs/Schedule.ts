import cron from 'node-cron'
import {populateMetrics} from './PopulateMetrics'
import {updateSessionAbandoned} from "./CloseSessionsJob";

class Schedule {
  execute(): void {
		cron.schedule('10 0 * * *', populateMetrics)
    cron.schedule('*/5 * * * *', updateSessionAbandoned)
  }
}

export default new Schedule()
