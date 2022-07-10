import express from 'express'
import {createServer} from 'http'
import {Server, Socket} from 'socket.io'
import WhatsAppClient from './Services/whatsapp/WhatsAppClient'
import config from '../config'
import {Store} from './Services/store/Store'
import * as Sentry from '@sentry/node'
import * as Tracing from '@sentry/tracing'

const app: express.Application = express()
const server = createServer(app)
let wpService: WhatsAppClient

Sentry.init({
  dsn: config.SENTRY_DSN,
  integrations: [
    new Sentry.Integrations.Http({tracing: true}),
    new Tracing.Integrations.Express({app})],
  
  tracesSampleRate: 1.0
})
app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())

server.listen(config.PORT, async () => {
  console.log('listen: ', config.PORT)
  wpService = new WhatsAppClient()
  wpService.initClient()
})

Store.getInstance()

const io = new Server(server, {cors: {origin: true}})

io.on('connection', (socket: Socket) => {
  wpService.setSocket(socket)

  socket.emit('client', wpService.client.info)

  socket.on('auth', async () => {
    console.log('auth from gorda web...')
    wpService.init().then(() => {
      console.log('whatsapp client initialized !!!!')
    }).catch(async e => {
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