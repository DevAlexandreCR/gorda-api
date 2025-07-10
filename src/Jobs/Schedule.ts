import cron from 'node-cron'
import {populateMetrics} from './PopulateMetrics'
import {updateSessionAbandoned} from './CloseSessionsJob'
import { setDynamicMinFee } from './SetDynamicMinFeeJob'
import { setDynamicMultiplierFee } from './SetDynamicMultiplierFeeJob'

class Schedule {
  execute(): void {
		cron.schedule('10 0 * * *', populateMetrics)
    cron.schedule('*/30 * * * *', updateSessionAbandoned)
    cron.schedule('0 * * * *', setDynamicMinFee)
    cron.schedule('*/5 * * * *', setDynamicMultiplierFee)
  }
}

export default new Schedule()
