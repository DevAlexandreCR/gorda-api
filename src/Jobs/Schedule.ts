import cron from 'node-cron'
import { populateMetrics } from './PopulateMetrics'
import { updateSessionAbandoned } from './CloseSessionsJob'
import { setDynamicMinFee } from './SetDynamicMinFeeJob'
import { setDynamicMultiplierFee } from './SetDynamicMultiplierFeeJob'
import { cancelPendingServices } from './CancelPendingServicesJob'
import { cleanIgnoredInboundAudit } from './CleanIgnoredInboundAuditJob'

class Schedule {
  execute(): void {
    cron.schedule('10 0 * * *', populateMetrics)
    cron.schedule('*/30 * * * *', updateSessionAbandoned)
    cron.schedule('0 * * * *', setDynamicMinFee)
    cron.schedule('*/5 * * * *', setDynamicMultiplierFee)
    cron.schedule('*/5 * * * *', cancelPendingServices)
    cron.schedule('30 0 * * *', cleanIgnoredInboundAudit, { timezone: 'UTC' })
  }
}

export default new Schedule()
