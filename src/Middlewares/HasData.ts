import { Socket } from 'socket.io'
import {
  getAdminVersionPolicy,
  isAdminVersionSupported,
  VERSION_UNSUPPORTED_CODE,
} from '../Helpers/VersionPolicy'

export function requiredClientId(socket: Socket<any>, next: (err?: Error) => void) {
  if (socket.handshake.query.clientId == 'undefined') {
    next(new Error('Not authorized'))
  } else if (
    socket.handshake.query.clientPlatform !== 'admin' ||
    !isAdminVersionSupported(String(socket.handshake.query.clientVersion ?? ''))
  ) {
    const error = new Error(VERSION_UNSUPPORTED_CODE) as Error & {
      data?: Record<string, unknown>
    }
    error.data = {
      code: VERSION_UNSUPPORTED_CODE,
      admin: getAdminVersionPolicy(),
    }
    next(error)
  } else {
    next()
  }
}
