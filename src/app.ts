import express, {Application} from 'express'
import http, {Server as HTTPServer} from 'http'
import https, {Server as HTTPSServer} from 'https'
import {Server as SocketIOServer, Socket} from 'socket.io'
import {WhatsAppClient} from './Services/whatsapp/WhatsAppClient'
import config from '../config'
import {Store} from './Services/store/Store'
import * as Sentry from '@sentry/node'
import * as Tracing from '@sentry/tracing'
import {Locale} from './Helpers/Locale'
import SSL from './Helpers/SSL'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import {RemoveConnectedDrivers} from './Jobs/RemoveConnectedDrivers'
import schedule from './Jobs/Schedule'
import SettingsRepository from './Repositories/SettingsRepository'
import {WpClient} from './Interfaces/WpClient'
import {WhatsAppClientDictionary} from './Interfaces/WhatsAppClientDiccionary'
import {ClientDictionary} from './Interfaces/ClientDiccionary'
import {requiredClientId} from './Middlewares/HasData'
import process from 'process'
import {spawn} from 'child_process'

dayjs.extend(utc)
dayjs.extend(timezone)

Locale.getInstance()

const app: Application = express()
let wpServices: WhatsAppClientDictionary = {}

Sentry.init({
  dsn: config.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({tracing: true}),
    new Tracing.Integrations.Express({app})],
  
  tracesSampleRate: 0.8
})

app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())
app.use(Sentry.Handlers.errorHandler());
app.use(express.static(__dirname, { dotfiles: 'allow' } ));

const serverSSL: HTTPSServer = https.createServer(SSL.getCredentials(config.APP_DOMAIN), app)
const server: HTTPServer = http.createServer(app)

const io: SocketIOServer = new SocketIOServer()
io.attach(server, {cors: {origin: true}})
io.attach(serverSSL, {cors: {origin: true}})
server.listen(config.PORT, async () => {
	console.log('listen: ', config.PORT)
  SettingsRepository.getWpClients((clients: ClientDictionary) => {
    Object.values(clients).forEach((client: WpClient) => {
      if (!wpServices[client.id]) {
        const wpService = new WhatsAppClient(client)
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

Store.getInstance()

io.use(requiredClientId)

io.on('connection', async (socket: Socket) => {
  const clientId = socket.handshake.query.clientId as string
  console.log('connected', socket.id, clientId)
	if (wpServices[clientId] && !wpServices[clientId].thereIsSocket()) {
    wpServices[clientId].setSocket(io)
  }

  if (clientId) await socket.join(clientId)

  if (wpServices[clientId]) socket.emit('client', wpServices[clientId].client.info)

  socket.on('auth', async () => {
    console.log('auth from gorda web...')
    if (wpServices[clientId]) wpServices[clientId].init().then(() => {
      console.log('whatsapp client initialized !!!!')
    }).catch(async e => {
			Sentry.captureException(e)
      console.log('error while authentication', e)
    })
  })

  socket.on('reset', async () => {
    console.log('reset was removed')
  })

  socket.on('get-state', async () => {
    if (wpServices[clientId]) wpServices[clientId].getState()
  })

  socket.on('destroy', async () => {
    console.log('destroy ....')
    if (wpServices[clientId]) {
      wpServices[clientId].deleting = true
      await wpServices[clientId].logout()
    }
    delete wpServices[clientId]
  })

  socket.on('starting', async () =>{
    if (wpServices[clientId]) {
      socket.emit('starting', wpServices[clientId].starting)
    }
  })

  socket.on('disconnect', reason => {
    console.log('disconnecting ...', reason)
  })
})

process.on('exit', async () => {
  const chromium = spawn(config.CHROMIUM_PATH, ['--remote-debugging-port=9222'], {
    stdio: 'ignore',
    detached: true
  })
  chromium.unref()
})