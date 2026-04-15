import express, { Application } from 'express'
import http, { Server as HTTPServer } from 'http'
import https, { Server as HTTPSServer } from 'https'
import path from 'path'
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
import AdminChatController from './Api/Controllers/Whatsapp/AdminChatController'
import polygonController from './Api/Controllers/Polygons/PolygonController'
import NotificationController from './Api/Controllers/Notifications/NotificationController'
import PlaceController from './Api/Controllers/Places/PlaceController'
import ClientController from './Api/Controllers/Clients/ClientController'
import HomeController from './Api/Controllers/Home/HomeController'
import Container from './Container/Container'
import { Store } from './Services/store/Store'
import { ChatBotMessage } from './Types/ChatBotMessage'
import { MessagesEnum } from './Services/chatBot/MessagesEnum'
import cors from 'cors'
import MasterDataController from './Api/Controllers/MasterData/MasterDataController'
import PublicMasterDataController from './Api/Controllers/MasterData/PublicMasterDataController'
import UsersController from './Api/Controllers/Users/UsersController'
import DriversController, {
  PublicDriversController,
} from './Api/Controllers/Drivers/DriversController'
import DriverAppController from './Api/Controllers/Drivers/DriverAppController'
import ServiceHistoryController from './Api/Controllers/Services/ServiceHistoryController'
import MetricsController from './Api/Controllers/Metrics/MetricsController'
import ServiceHistoryInternalController from './Api/Controllers/Internal/ServiceHistoryInternalController'
import type { CorsOptions } from 'cors'
import ChatRealtimeGateway from './Services/whatsapp/ChatRealtimeGateway'
import DatabaseService from './Services/firebase/Database'

dayjs.extend(utc)
dayjs.extend(timezone)

Locale.getInstance()

const app: Application = express()
let wpServices: WhatsAppClientDictionary = {}
const localOriginPattern = /^http?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

Sentry.init({
  dsn: config.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({ app }),
  ],

  tracesSampleRate: 0.8,
})

if (config.NODE_ENV !== 'production') {
  const localCorsOptions: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }

      callback(null, localOriginPattern.test(origin))
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-Client-Platform',
      'X-Client-Version',
      'baggage',
      'sentry-trace',
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  }

  app.use(cors(localCorsOptions))
  app.options('*', cors(localCorsOptions))
}
app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())
app.use(Sentry.Handlers.errorHandler())

// Serve static files for assets
app.use('/assets', express.static(path.join(process.cwd(), 'src/assets')))
app.use('/assets', express.static(path.join(process.cwd(), 'assets')))
app.use('/assets', express.static(path.join(__dirname, '../assets')))

// Serve other static files
app.use(express.static(__dirname, { dotfiles: 'allow' }))
app.use(express.json())
app.use(HomeController)
app.use(controller)
app.use('/whatsapp', AdminChatController)
app.use(polygonController)
app.use(NotificationController)
app.use('/places', PlaceController)
app.use('/clients', ClientController)
app.use('/master-data', MasterDataController)
app.use('/public/master-data', PublicMasterDataController)
app.use('/users', UsersController)
app.use('/drivers', DriversController)
app.use('/public/drivers', PublicDriversController)
app.use('/driver-app', DriverAppController)
app.use('/services', ServiceHistoryController)
app.use('/metrics', MetricsController)
app.use('/internal/service-history', ServiceHistoryInternalController)

const serverSSL: HTTPSServer = https.createServer(SSL.getCredentials(config.APP_DOMAIN), app)
const server: HTTPServer = http.createServer(app)

const store = Store.getInstance()

const io: SocketIOServer = new SocketIOServer()
io.attach(server, { cors: { origin: true } })
io.attach(serverSSL, { cors: { origin: true } })
ChatRealtimeGateway.setSocketServer(io)
server.listen(config.PORT, async () => {
  console.log('listen: ', config.PORT)

  await Container.initialize().catch((error) => {
    console.error('Failed to initialize container:', error)
    process.exit(1)
  })

  await DatabaseService.dbVersionPolicy()
    .update({
      min_driver_version_code: config.DRIVER_MIN_VERSION_CODE,
    })
    .catch((error) => {
      console.error('Failed to synchronize driver version policy:', error)
      process.exit(1)
    })

  await store.refreshDrivers()
  await store.refreshMessages()
  await store.getBranches()
  store.getWpClients((clients: ClientDictionary) => {
    const activeClientIds = new Set(Object.keys(clients))

    Object.values(clients).forEach((client: WpClient) => {
      if (!wpServices[client.id]) {
        const wpService = new WhatsAppClient(client)
        wpService.setWpClient(client)
        wpService.initClient()
        wpServices[client.id] = wpService
        store.registerWhatsAppClient(client.id, wpService)
      } else {
        wpServices[client.id].setWpClient(client)
      }
    })

    Object.keys(wpServices).forEach(async (clientId) => {
      if (activeClientIds.has(clientId)) return

      try {
        wpServices[clientId].deleting = true
        await wpServices[clientId].logout()
      } catch (error) {
        console.error(`Error shutting down WhatsApp client ${clientId}:`, error)
      }

      delete wpServices[clientId]
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
      await wpServices[wpClient].sendMessage(chatId, message)
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
