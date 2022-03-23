import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { Client } from 'whatsapp-web.js'

const app: express.Application = express()
const server = createServer(app)

server.listen(5000, () => {
  console.log('listen 5000')
})

const io = new Server(server, {
  cors: {
    origin: true
  }
})

io.on('connection', (socket: Socket) => {
  console.log('admin connected')
  
  socket.on('auth', async () => {
    const client = new Client({
      puppeteer: {
        args: ['--use-gl=egl']
      }
    })
  
    client.on('qr', (qr) => {
      console.log('QR RECEIVED', qr);
      socket.emit('qr-code', qr)
    })
  
    client.initialize().then(() => {
      console.log('whatsapp initialized')
    })
  })
})