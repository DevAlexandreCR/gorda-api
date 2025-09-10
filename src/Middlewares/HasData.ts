import { Socket } from 'socket.io'

export function requiredClientId(socket: Socket<any>, next: (err?: Error) => void) {
  if (socket.handshake.query.clientId == 'undefined') {
    next(new Error('Not authorized'))
  } else {
    next()
  }
}
