import express, { Application } from 'express'
import http, { Server as HTTPServer } from 'http'
import https, { Server as HTTPSServer } from 'https'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { WhatsAppClient } from './Services/whatsapp/WhatsAppClient'
import config from '../config'
import * as Sentry from '@sentry/node'
import * as Tracing from '@sentry/tracing'
import { Locale } from './Helpers/Locale'
import SSL from './Helpers/SSL'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { RemoveConnectedDrivers } from './Jobs/RemoveConnectedDrivers'
import schedule from './Jobs/Schedule'
import { WpClient } from './Interfaces/WpClient'
import { WhatsAppClientDictionary } from './Interfaces/WhatsAppClientDiccionary'
import { ClientDictionary } from './Interfaces/ClientDiccionary'
import { requiredClientId } from './Middlewares/HasData'
import controller from './Api/Controllers/Whatsapp/MessageController'
import polygonController from './Api/Controllers/Polygons/PolygonController'
import NotificationController from './Api/Controllers/Notifications/NotificationController'
import PlaceController from './Api/Controllers/Places/PlaceController'
import Container from './Container/Container'
import { Store } from './Services/store/Store'
import { ChatBotMessage } from './Types/ChatBotMessage'
import { MessagesEnum } from './Services/chatBot/MessagesEnum'
import cors from 'cors'

dayjs.extend(utc)
dayjs.extend(timezone)

Locale.getInstance()

const app: Application = express()
let wpServices: WhatsAppClientDictionary = {}

Sentry.init({
  dsn: config.SENTRY_DSN,
  integrations: [new Sentry.Integrations.Http({ tracing: true }), new Tracing.Integrations.Express({ app })],

  tracesSampleRate: 0.8,
})

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}))
app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())
app.use(Sentry.Handlers.errorHandler())
app.use(express.static(__dirname, { dotfiles: 'allow' }))
app.use(express.json())
app.use(controller)
app.use(polygonController)
app.use(NotificationController)
app.use('/places', PlaceController)

const serverSSL: HTTPSServer = https.createServer(SSL.getCredentials(config.APP_DOMAIN), app)
const server: HTTPServer = http.createServer(app)

const store = Store.getInstance()

const io: SocketIOServer = new SocketIOServer()
io.attach(server, { cors: { origin: true } })
io.attach(serverSSL, { cors: { origin: true } })
server.listen(config.PORT, async () => {
  console.log('listen: ', config.PORT)

  await Container.initialize().catch((error) => {
    console.error('Failed to initialize container:', error)
    process.exit(1)
  })

  store.getBranches()
  store.getWpClients((clients: ClientDictionary) => {
    Object.values(clients).forEach((client: WpClient) => {
      if (!wpServices[client.id]) {
        const wpService = new WhatsAppClient(client)
        wpService.setWpClient(client)
        wpService.initClient()
        wpServices[client.id] = wpService
      } else {
        wpServices[client.id].setWpClient(client)
      }
    })
  })
  const removeDrivers = new RemoveConnectedDrivers()
  removeDrivers.execute()
  schedule.execute()
})
serverSSL.listen(443, async () => {
  console.log('listen: ', 443)
})

io.use(requiredClientId)

io.on('connection', async (socket: Socket) => {
  const clientId = socket.handshake.query.clientId as string
  console.log('connected', socket.id, clientId)
  if (wpServices[clientId] && !wpServices[clientId].thereIsSocket()) {
    wpServices[clientId].setSocket(io)
  }

  if (clientId) await socket.join(clientId)

  if (wpServices[clientId]) socket.emit('client', wpServices[clientId].client.getInfo())

  socket.on('auth', async () => {
    console.log('auth from gorda web...')
    if (wpServices[clientId])
      wpServices[clientId]
        .init()
        .then(() => {
          console.log('whatsapp client initialized !!!!')
        })
        .catch(async (e) => {
          Sentry.captureException(e)
          console.log('error while authentication', e)
        })
  })

  socket.on('get-state', async () => {
    if (wpServices[clientId]) wpServices[clientId].getState()
  })

  socket.on('reset', async () => {
    console.log('restarting by user: ', clientId)
    process.exit(0)
  })

  socket.on('destroy', async () => {
    console.log('destroy ....')
    if (wpServices[clientId]) {
      wpServices[clientId].deleting = true
      await wpServices[clientId].logout()
    }
    delete wpServices[clientId]
  })

  socket.on('starting', async () => {
    if (wpServices[clientId]) {
      socket.emit('starting', wpServices[clientId].starting)
    }
  })

  socket.on('send-message', async (wpClient: string, chatId: string, content: string) => {
    if (wpServices[wpClient]) {
      const message: ChatBotMessage = {
        id: MessagesEnum.MESSAGE_FROM_ADMIN,
        message: content,
        name: MessagesEnum.MESSAGE_FROM_ADMIN,
        enabled: true,
        description: 'Mensaje enviado desde el panel de control',
        interactive: null,
      }
      await wpServices[clientId].sendMessage(chatId, message)
    }
  })

  socket.on('disconnect', (reason) => {
    console.log('disconnecting ...', reason)
  })
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...')
  await Container.cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  await Container.cleanup()
  process.exit(0)
})

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error)
  await Container.cleanup()
  process.exit(1)
})

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  await Container.cleanup()
  process.exit(1)
})
