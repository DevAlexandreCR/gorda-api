import Database from '../Services/firebase/Database'
import Service from '../Models/Service'
import dayjs from 'dayjs'
import * as Sentry from '@sentry/node'

const PENDING_SERVICE_TIMEOUT = 15 * 60 * 1000

function isServiceExpired(createdAt: number): boolean {
  const now = dayjs().unix() * 1000
  const serviceAge = now - (createdAt * 1000)

  return serviceAge > PENDING_SERVICE_TIMEOUT
}

export async function cancelPendingServices(): Promise<void> {
  try {
    console.log('Checking for expired pending services...')

    const snapshot = await Database.dbServices()
      .orderByChild('status')
      .equalTo(Service.STATUS_PENDING)
      .once('value')

    if (!snapshot.exists()) {
      console.log('No pending services found.')
      return
    }

    const services = snapshot.val()
    const cancelPromises: Promise<void>[] = []
    let canceledCount = 0

    Object.keys(services).forEach((serviceId) => {
      const service = services[serviceId]

      if (isServiceExpired(service.created_at)) {
        console.log(`Canceling expired service ${serviceId} (created at: ${dayjs.unix(service.created_at).format('YYYY-MM-DD HH:mm:ss')})`)

        cancelPromises.push(
          Database.dbServices()
            .child(serviceId)
            .update({ status: Service.STATUS_CANCELED })
            .then(() => {
              canceledCount++
            })
        )
      }
    })

    await Promise.all(cancelPromises)

    if (canceledCount > 0) {
      console.log(`Successfully canceled ${canceledCount} expired pending service(s).`)
    } else {
      console.log('No expired pending services found.')
    }
  } catch (error) {
    console.error('Error canceling pending services:', error)
    Sentry.captureException(error)
  }
}
