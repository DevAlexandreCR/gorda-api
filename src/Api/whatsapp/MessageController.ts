import { OfficialClient } from '../../Services/whatsapp/services/Official/OfficialClient'
import { WpMessageAdapter } from '../../Services/whatsapp/services/Official/Adapters/WpMessageAdapter'
import { Request, Response, Router } from 'express'
import { WpEvents } from '../../Services/whatsapp/constants/WpEvents'
import { Store } from '../../Services/store/Store'
import MessageRepository from '../../Repositories/MessageRepository'
import { WpContactAdapter } from '../../Services/whatsapp/services/Official/Adapters/WpContactAdapter'
import { ClientInterface } from '../../Interfaces/ClientInterface'

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
      const profileName = value.contacts[0]?.profile.name
      const wpClient = store.wpClients[value.metadata.phone_number_id] ?? null
      if (!wpClient) {
        console.log('wpClient not found')
        responseMessages.push('wpClient not found')

        return
      }
      const wpClientService = OfficialClient.getInstance(wpClient)

      const messages = value.messages

      messages.forEach(async (message: any) => {
        const wpMessage = new WpMessageAdapter(
          {
            id: message.id,
            timestamp: message.timestamp,
            type: message.type ? message.type : message.location ? 'location' : 'unknown',
            from: message.from,
            isStatus: false,
            body: message.text?.body ?? '',
            location: message.location
              ? {
                  name: message.location.name,
                  lat: message.location.latitude,
                  lng: message.location.longitude,
                }
              : undefined,
          },
          wpClientService,
        )

        const contact = store.findClientById(wpMessage.from)
        if (!contact) {
          const newClient = new WpContactAdapter({
            id: wpMessage.from,
            name: profileName ?? 'Usuario',
            phone: wpMessage.from,
            photoUrl: '',
          } as ClientInterface)
          await store.createClient(newClient)
        }

        const chat = await store.getChatById(wpMessage.from, profileName)

        await MessageRepository.addMessage(chat.id, {
          id: wpMessage.id,
          created_at: wpMessage.timestamp as number,
          type: message.type ? message.type : message.location ? 'location' : 'unknown',
          body: wpMessage.body,
          location: wpMessage.location ?? null,
          fromMe: false,
        })

        wpClientService.triggerEvent(WpEvents.MESSAGE_RECEIVED, wpMessage)
      })
    })
  })

  return res.status(200).json({ messages: responseMessages })
})

export default controller
