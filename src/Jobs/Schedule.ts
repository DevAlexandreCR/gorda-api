import cron from 'node-cron'
import { updateSessionAbandoned } from './CloseSessionsJob'
import { setDynamicMinFee } from './SetDynamicMinFeeJob'
import { setDynamicMultiplierFee } from './SetDynamicMultiplierFeeJob'
import { cancelPendingServices } from './CancelPendingServicesJob'
import { cleanIgnoredInboundAudit } from './CleanIgnoredInboundAuditJob'
import { cleanProcessedInboundMessages } from './CleanProcessedInboundMessagesJob'
import { runPhase5FirestoreDailyCleanup } from '../Migration/phase5FirebaseCleanup'
import { sendMonthlyPaymentReminders } from './MonthlyPaymentReminderJob'
import { disableUnpaidMonthlyDrivers } from './DisableUnpaidMonthlyDriversJob'

class Schedule {
  execute(): void {
    cron.schedule('*/30 * * * *', updateSessionAbandoned)
    cron.schedule('0 * * * *', setDynamicMinFee)
    cron.schedule('*/5 * * * *', setDynamicMultiplierFee)
    cron.schedule('*/5 * * * *', cancelPendingServices)
    cron.schedule('30 6 * * *', cleanIgnoredInboundAudit, { timezone: 'UTC' })
    cron.schedule('45 6 * * *', cleanProcessedInboundMessages, { timezone: 'UTC' })
    cron.schedule('15 7 * * *', runPhase5FirestoreDailyCleanup, { timezone: 'UTC' })
    cron.schedule('5 0 * * *', sendMonthlyPaymentReminders, { timezone: 'America/Bogota' })
    cron.schedule('10 0 * * *', disableUnpaidMonthlyDrivers, { timezone: 'America/Bogota' })
  }
}

export default new Schedule()
