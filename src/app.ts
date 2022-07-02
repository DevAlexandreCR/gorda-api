import express from 'express'
import {createServer} from 'http'
import {Server, Socket} from 'socket.io'
import WhatsAppClient from './Services/whatsapp/WhatsAppClient'
import config from '../config'
import {Store} from './Services/store/Store'

const app: express.Application = express()
const server = createServer(app)
let wpService: WhatsAppClient

server.listen(config.PORT, () => {
  console.log('listen: ', config.PORT)
  wpService = new WhatsAppClient()
})

Store.getInstance()

const io = new Server(server, {cors: {origin: true}})

io.on('connection', (socket: Socket) => {
  console.log('admin connected -> ' + socket.id)
  wpService.setSocket(socket)
  
  socket.emit('client', wpService.client.info)
  
  socket.on('auth', async () => {
    console.log('auth ....')
    wpService.init().then(() => {
      console.log('initialized !!!!')
    }).catch(async e => {
      console.log(e.message)
      await wpService.client.destroy()
      await wpService.initClient()
    })
  })
  
  socket.on('reset', async () => {
    console.log('reset was removed')
  })
  
  socket.on('get-state', async () => {
    console.log('get-state ....')
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