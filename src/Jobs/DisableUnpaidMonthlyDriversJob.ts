import { Op } from 'sequelize'
import Container from '../Container/Container'
import DriverRecord from '../Models/DriverRecord'
import DatabaseService from '../Services/firebase/Database'
import FCM from '../Services/firebase/FCM'
import { forceDisconnect } from '../Services/drivers/ForceDisconnect'
import { currentDayOfMonth, currentPeriod } from '../Services/time/BogotaTime'
import { Store } from '../Services/store/Store'

const DISABLE_REASON = 'monthly_payment_overdue'

export async function disableUnpaidMonthlyDrivers(): Promise<void> {
  const settings = await Container.getMonthlyPaymentSettingsRepository().get()

  if (currentDayOfMonth() !== settings.cutoff_day || !settings.auto_disable) {
    return
  }

  const driverIds =
    await Container.getMonthlyPaymentRepository().findUnpaidMonthlyDriverIds(currentPeriod())

  if (driverIds.length === 0) {
    return
  }

  await DriverRecord.update({ enabled_at: 0 }, { where: { id: { [Op.in]: driverIds } } })

  const processed: string[] = []
  const failed: { id: string; reason: string }[] = []

  await Promise.allSettled(
    driverIds.map(async (driverId) => {
      try {
        const onlineSnapshot = await DatabaseService.dbConnectedDrivers()
          .child(driverId)
          .once('value')

        if (onlineSnapshot.exists()) {
          await forceDisconnect(driverId, DISABLE_REASON)
        } else {
          const tokenRecord =
            await Container.getDriverTokenRecordRepository().findByDriverId(driverId)
          if (!tokenRecord?.token) {
            failed.push({ id: driverId, reason: 'Driver token not found' })
            return
          }
          await FCM.sendNotificationTo(tokenRecord.token, {
            title: '',
            body: '',
            data: { type: 'alert', reason: DISABLE_REASON },
          })
        }
        processed.push(driverId)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        failed.push({ id: driverId, reason })
      }
    })
  )

  console.log(
    JSON.stringify({
      event: 'disable_unpaid_monthly_drivers',
      processed: processed.length,
      failed,
    })
  )

  await Store.getInstance().refreshDrivers()
}
