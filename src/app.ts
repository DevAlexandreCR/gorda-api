import express from 'express'
import {createServer} from 'http'
import {Server, Socket} from 'socket.io'
import WhatsAppClient from "./Services/whatsapp/WhatsAppClient";

const app: express.Application = express()
const server = createServer(app)
let wpService: WhatsAppClient

server.listen(3000, () => {
  console.log('listen 3000')
  wpService = new WhatsAppClient()
})

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
    console.log('reset ....')
    wpService.reset()
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