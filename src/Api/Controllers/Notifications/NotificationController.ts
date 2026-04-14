import { Request, Response, Router } from 'express'
import { Store } from '../../../Services/store/Store'
import FCM from '../../../Services/firebase/FCM'
import { FCMNotification } from '../../../Types/FCMNotifications'
import Container from '../../../Container/Container'

const controller = Router()
const store = Store.getInstance()
const DRIVER_FCM_BATCH_SIZE = 500

function buildDriverNotificationPayload(message: FCMNotification): FCMNotification {
  return {
    title: message.title || 'New Message',
    body: message.body || 'You have a new message',
    data: {
      ...message.data,
      title: message.title || 'New Message',
      body: message.body || 'You have a new message',
      type: 'alert',
    },
  }
}

async function sendNotificationToDriverTokens(tokens: string[], message: FCMNotification) {
  const payload = buildDriverNotificationPayload(message)
  let delivered = 0
  let failed = 0

  for (let index = 0; index < tokens.length; index += DRIVER_FCM_BATCH_SIZE) {
    const batch = tokens.slice(index, index + DRIVER_FCM_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((token) => FCM.sendNotificationTo(token, payload))
    )

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        delivered += 1
        return
      }
      failed += 1
    })
  }

  return { delivered, failed }
}

controller.post('/messages/drivers', async (req: Request, res: Response) => {
  const { body } = req
  const to = body.to
  const message = body.message as FCMNotification
  if (to !== null && typeof to !== 'string') {
    return res.status(400).json({ error: '"to" must be null or a string' })
  }

  if (
    !message ||
    typeof message !== 'object' ||
    !message.title ||
    !message.body ||
    typeof message.title !== 'string' ||
    typeof message.body !== 'string'
  ) {
    return res
      .status(400)
      .json({ error: '"message" must be an object with "title" and "body" as strings' })
  }

  if (message.data && typeof message.data === 'object') {
    for (const key in message.data) {
      if (typeof key !== 'string' || typeof message.data[key] !== 'string') {
        return res
          .status(422)
          .json({ error: '"message.data" must be an object with string keys and string values' })
      }
    }
  } else if (message.data !== undefined) {
    return res
      .status(422)
      .json({ error: '"message.data" must be an object with string keys and string values' })
  }

  if (!to) {
    try {
      const driverTokens = await Container.getDriverTokenRecordRepository().findAll()
      const tokens = Array.from(
        new Set(
          driverTokens
            .map((driverToken) => driverToken.token)
            .filter((token): token is string => typeof token === 'string' && token.length > 0)
        )
      )

      if (!tokens.length) {
        return res.status(200).json({
          message: 'No driver tokens available for notification delivery',
          delivered: 0,
          failed: 0,
        })
      }

      const result = await sendNotificationToDriverTokens(tokens, message)

      if (!result.delivered && result.failed) {
        return res.status(500).json({
          error: 'Error sending notification to drivers',
          delivered: 0,
          failed: result.failed,
        })
      }

      return res.status(200).json({
        message: 'Notification sent to all drivers',
        delivered: result.delivered,
        failed: result.failed,
      })
    } catch (error) {
      console.error('Error sending notification to drivers:', error)
      return res.status(500).json({ error: 'Error sending notification to drivers' })
    }
  }

  const driver = store.drivers.get(to)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }
  const { id, name } = driver

  const driverToken = await Container.getDriverTokenRecordRepository().findByDriverId(id!!)
  if (!driverToken) {
    return res.status(404).json({ error: 'Driver token not found' })
  }
  try {
    await FCM.sendNotificationTo(driverToken.token, buildDriverNotificationPayload(message))
    return res.status(200).json({ message: `Notification sent to driver ${name}` })
  } catch (error) {
    console.error(`Error sending notification to driver ${name} (${id}):`, error)
    return res.status(500).json({ error: `Error sending notification to driver ${name}` })
  }
})

export default controller
