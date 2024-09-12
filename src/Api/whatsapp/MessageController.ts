import {OfficialClient} from '../../Services/whatsapp/services/Official/OfficialClient'
import {WpMessageAdapter} from '../../Services/whatsapp/services/Official/Adapters/WpMessageAdapter'
import {Request, Response, Router} from 'express'
import {WpEvents} from '../../Services/whatsapp/constants/WpEvents'
import {Store} from '../../Services/store/Store'
import MessageRepository from '../../Repositories/MessageRepository'
import config from '../../../config'
import {MessageTypes} from "../../Services/whatsapp/constants/MessageTypes";
import {MessagesEnum} from "../../Services/chatBot/MessagesEnum";
import MessageHelper from "../../Helpers/MessageHelper";

const controller = Router()
const store = Store.getInstance()

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
      const profileName = value.contacts? value.contacts[0]?.profile.name : undefined
      const wpClient = store.wpClients[value.metadata.phone_number_id] ?? null
      if (!wpClient) {
        console.log('wpClient not found')
        responseMessages.push('wpClient not found')

        return
      }
      const wpClientService = OfficialClient.getInstance(wpClient)

      const messages = value.messages

      messages.forEach(async (message: any) => {
        const type: MessageTypes =  message.type ? message.type : message.location ? MessageTypes.LOCATION : MessageTypes.UNKNOWN
        const wpMessage = new WpMessageAdapter(
          {
            id: message.id,
            timestamp: typeof message.timestamp === 'string' ? parseInt(message.timestamp) : message.timestamp,
            from: message.from + '@c.us',
            type: type,
            isStatus: false,
            body: message.text?.body ?? type,
            location: message.location
              ? {
                  name: message.location.name ?? MessageHelper.LOCATION_NO_NAME,
                  lat: message.location.latitude,
                  lng: message.location.longitude,
                }
              : undefined,
          },
          wpClientService,
        )

        const chat = await store.getChatById(wpClient.id, wpMessage.from, profileName)

        await MessageRepository.addMessage(wpClient.id, chat.id, {
          id: wpMessage.id,
          created_at: typeof message.timestamp === 'string' ? parseInt(message.timestamp) : message.timestamp,
          type: message.type ? message.type : message.location ? 'location' : 'unknown',
          body: wpMessage.body,
          location: wpMessage.location ?? null,
          fromMe: false,
        })

        wpClientService.triggerEvent(WpEvents.MESSAGE_RECEIVED, wpMessage)

        if (type !== MessageTypes.TEXT && type !== MessageTypes.LOCATION) {
          const msg = store.findMessageById(MessagesEnum.MESSAGE_TYPE_NOT_SUPPORTED)
          wpClientService.sendMessage(wpMessage.from, msg.message)
        }
      })
    })
  })

  return res.status(200).json({ messages: responseMessages })
})

controller.get('/whatsapp/webhook', async (req: Request, res: Response) => {
  console.log('webhook get', req.query)

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.FIREBASE_PROJECT_ID) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
})

export default controller
