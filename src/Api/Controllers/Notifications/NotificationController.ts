import { Request, Response, Router } from "express"
import { Store } from "../../../Services/store/Store"
import DriverRepository from "../../../Repositories/DriverRepository"
import FCM from "../../../Services/firebase/FCM"
import { FCMNotification } from "../../../Types/FCMNotifications"

const controller = Router()
const store = Store.getInstance()

controller.post('/messages/drivers', async (req: Request, res: Response) => {
    const { body } = req
    const to = body.to
    const message = body.message as FCMNotification
    if (to !== null && typeof to !== 'string') {
        return res.status(400).json({ error: '"to" must be null or a string' })
    }

    if (!message || typeof message !== 'object' || !message.title || !message.body ||
        typeof message.title !== 'string' || typeof message.body !== 'string'
    ) {
        return res.status(400).json({ error: '"message" must be an object with "title" and "body" as strings' })
    }

    if (!to) {
        FCM.sendDifusionNotification('drivers', {
            title: message.title || 'New Message',
            body: message.body || 'You have a new message',
            data: message.data || {},
        }).then(() => {
            return res.status(200).json({ message: 'Notification sent to all drivers' })
        }).catch((error) => {
            console.error('Error sending notification to drivers:', error)
            return res.status(500).json({ error: 'Error sending notification to drivers' })
        })
    } else {
        const driver = store.drivers.get(to)
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' })
        }
        const { id, name } = driver

        const token = await DriverRepository.getToken(id!!)
        if (!token) {
            return res.status(404).json({ error: 'Driver token not found' })
        }
        await FCM.sendNotificationTo(token, {
            title: message.title || 'New Message',
            body: message.body || 'You have a new message',
            data: message.data || {},
        }).then(() => {
            return res.status(200).json({ message: `Notification sent to driver ${name}` })
        }).catch((error) => {
            console.error(`Error sending notification to driver ${name} (${id}):`, error)
            return res.status(500).json({ error: `Error sending notification to driver ${name}` })
        })
    }
})

export default controller