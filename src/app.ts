import express, {Application} from 'express'
import http, {Server as HTTPServer} from 'http'
import https, {Server as HTTPSServer} from 'https'
import {Server as SocketIOServer, Socket} from 'socket.io'
import WhatsAppClient from './Services/whatsapp/WhatsAppClient'
import config from '../config'
import {Store} from './Services/store/Store'
import * as Sentry from '@sentry/node'
import * as Tracing from '@sentry/tracing'
import {Locale} from './Helpers/Locale'
import SSL from './Helpers/SSL'

Locale.getInstance()

const app: Application = express()
let wpService: WhatsAppClient

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
	wpService = new WhatsAppClient()
	wpService.initClient()
})
serverSSL.listen(443, async () => {
	console.log('listen: ', 443)
	wpService = new WhatsAppClient()
	wpService.initClient()
})

Store.getInstance()

io.on('connection', (socket: Socket) => {
  wpService.setSocket(socket)

  socket.emit('client', wpService.client.info)

  socket.on('auth', async () => {
    console.log('auth from gorda web...')
    wpService.init().then(() => {
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
    wpService.getState()
  })

  socket.on('destroy', async () => {
    console.log('destroy ....')
    wpService.logout()
  })

  socket.on('disconnect', reason => {
    console.log('disconnecting ...', reason)
    socket.disconnect(true)
  })
})