import Container from '../Container/Container'
import FCM from '../Services/firebase/FCM'
import { currentDayOfMonth, currentPeriod } from '../Services/time/BogotaTime'

const REMINDER_REASON = 'monthly_payment_reminder'

export async function sendMonthlyPaymentReminders(): Promise<void> {
  const settings = await Container.getMonthlyPaymentSettingsRepository().get()

  const reminderDays = settings.reminder_offsets
    .map((offset) => settings.cutoff_day - offset)
    .filter((day) => day >= 1)

  if (!reminderDays.includes(currentDayOfMonth())) {
    return
  }

  const driverIds = await Container.getMonthlyPaymentRepository().findUnpaidMonthlyDriverIds(
    currentPeriod()
  )

  if (driverIds.length === 0) {
    return
  }

  const processed: string[] = []
  const failed: { id: string; reason: string }[] = []

  await Promise.allSettled(
    driverIds.map(async (driverId) => {
      try {
        const tokenRecord = await Container.getDriverTokenRecordRepository().findByDriverId(
          driverId
        )
        if (!tokenRecord?.token) {
          failed.push({ id: driverId, reason: 'Driver token not found' })
          return
        }
        await FCM.sendNotificationTo(tokenRecord.token, {
          title: '',
          body: '',
          data: {
            type: 'alert',
            reason: REMINDER_REASON,
            suggested_amount: String(settings.suggested_amount),
            cutoff_day: String(settings.cutoff_day),
          },
        })
        processed.push(driverId)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        failed.push({ id: driverId, reason })
      }
    })
  )

  console.log(
    JSON.stringify({
      event: 'monthly_payment_reminder',
      processed: processed.length,
      failed,
    })
  )
}
