import cron from 'node-cron'
import {populateMetrics} from './PopulateMetrics'
import {updateSessionAbandoned} from './CloseSessionsJob'
import { setDynamicMinFee } from './SetDynamicMinFeeJob'

class Schedule {
  execute(): void {
		cron.schedule('10 0 * * *', populateMetrics)
    cron.schedule('*/30 * * * *', updateSessionAbandoned)
    cron.schedule('5 6,18 * * *', setDynamicMinFee)
  }
}

export default new Schedule()
