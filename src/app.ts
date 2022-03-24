import express from 'express'
import {createServer} from 'http'
import {Server, Socket} from 'socket.io'
import WhatsAppClient from "./Services/whatsapp/WhatsAppClient";

const app: express.Application = express()
const server = createServer(app)

server.listen(3000, () => {
  console.log('listen 3000')
})

const io = new Server(server, {cors: {origin: true}})

io.on('connection', (socket: Socket) => {
  socket.on('auth', async () => {
    const wpService = new WhatsAppClient(socket)
    wpService.init().then(() => {
      console.log('initialized !!!!')
    })
  })
})