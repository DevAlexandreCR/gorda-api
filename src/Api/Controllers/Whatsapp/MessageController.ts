import { OfficialClient } from '../../../Services/whatsapp/services/Official/OfficialClient'
import { WpMessageAdapter } from '../../../Services/whatsapp/services/Official/Adapters/WpMessageAdapter'
import { Request, Response, Router } from 'express'
import { WpEvents } from '../../../Services/whatsapp/constants/WpEvents'
import { Store } from '../../../Services/store/Store'
import MessageRepository from '../../../Repositories/MessageRepository'
import config from '../../../../config'
import { MessageTypes } from '../../../Services/whatsapp/constants/MessageTypes'
import { MessagesEnum } from '../../../Services/chatBot/MessagesEnum'
import MessageHelper from '../../../Helpers/MessageHelper'

const controller = Router()
const store = Store.getInstance()
const MAX_MESSAGE_AGE_MINUTES = 20

controller.post('/whatsapp/webhook', async (req: Request, res: Response) => {
  const { body } = req
  const entries = body.entry
  const responseMessages: Array<string> = ['ok']
  entries.forEach((entry: any) => {
    const changes = entry.changes

    changes.forEach((change: any) => {
      if (change.field !== 'messages') {
        console.log('no message notification')
        responseMessages.push('no message notification')
        return
      }
      const value = change.value
      if (value.errors) {
        console.log('Message error', JSON.stringify(value.errors))
        responseMessages.push('Message with errors')
        return
      }

      if (!value.messages) {
        console.log('No messages', JSON.stringify(value))
        responseMessages.push('No Messages')
        return
      }
      const profileName = value.contacts ? value.contacts[0]?.profile?.name : undefined
      const wpClient = store.wpClients[value.metadata.phone_number_id] ?? null
      if (!wpClient) {
        console.log('wpClient not found')
        responseMessages.push('wpClient not found')

        return
      }
      const wpClientService = OfficialClient.getInstance(wpClient)

      const messages = value.messages

      messages.forEach(async (message: any) => {
        if (message.text && message.text.body === 'PING') {
          console.log('PING message received, ignoring.')
          return
        }
        if (message.type === 'system') {
          console.log('System message received, ignoring.')
          return
        }
        if (message.text && !message.text.body?.trim()) {
          console.log('Empty message body received, ignoring.')
          return
        }
        const messageTimestamp =
          typeof message.timestamp === 'string' ? parseInt(message.timestamp, 10) : message.timestamp
        const currentTimestamp = Math.floor(Date.now() / 1000)
        const messageAgeMinutes = (currentTimestamp - messageTimestamp) / 60

        if (messageAgeMinutes > MAX_MESSAGE_AGE_MINUTES) {
          console.log(
            `Old message ignored. Age: ${messageAgeMinutes.toFixed(2)} minutes. Message ID: ${message.id}`
          )
          responseMessages.push(`Old message ignored: ${message.id}`)
          return
        }

        const type: MessageTypes = message.text?.body
          ? MessageTypes.TEXT
          : message.location
            ? MessageTypes.LOCATION
            : message.type
              ? message.type
              : MessageTypes.UNKNOWN
        const wpMessage = new WpMessageAdapter(
          {
            id: message.id,
            timestamp: messageTimestamp,
            from: message.from + '@c.us',
            type: type,
            isStatus: false,
            body: message.text?.body ?? type,
            location: message.location
              ? {
                name: message.location?.name ?? MessageHelper.LOCATION_NO_NAME,
                lat: message.location?.latitude,
                lng: message.location?.longitude,
              }
              : undefined,
            interactiveReply: message.interactive ?? null,
          },
          wpClientService
        )

        if (wpMessage.interactiveReply) {
          wpMessage.body = wpMessage.interactiveReply.button_reply?.id ?? wpMessage.body
        }

        const chat = await store.getChatById(wpClient.id, message.from, profileName)

        await MessageRepository.addMessage(wpClient.id, chat.id, {
          id: wpMessage.id,
          created_at: messageTimestamp,
          type: type,
          body: wpMessage.body,
          location: wpMessage.location ?? null,
          fromMe: false,
          interactiveReply: wpMessage.interactiveReply,
          interactive: null,
        })

        wpClientService.triggerEvent(WpEvents.MESSAGE_RECEIVED, wpMessage)

        const hasTextContent = message.text?.body?.trim()
        const isProcessableType =
          type === MessageTypes.TEXT ||
          type === MessageTypes.LOCATION ||
          type === MessageTypes.INTERACTIVE

        if (!hasTextContent && !isProcessableType) {
          const msg = store.findMessageById(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED)
          wpClientService.sendMessage(wpMessage.from, msg)
        }
      })
    })
  })

  return res.status(200).json({ messages: responseMessages })
})

controller.get('/whatsapp/webhook', async (req: Request, res: Response) => {
  console.log('webhook get', req.query)

  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode && token) {
    if (mode === 'subscribe' && token === config.FIREBASE_PROJECT_ID) {
      console.log('WEBHOOK_VERIFIED')
      res.status(200).send(challenge)
    } else {
      res.sendStatus(403)
    }
  } else {
    res.sendStatus(422)
  }
})

export default controller
