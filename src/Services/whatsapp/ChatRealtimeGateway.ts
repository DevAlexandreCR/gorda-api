import { EventEmitter } from 'events'
import { Server as SocketIOServer } from 'socket.io'
import { Chat } from '../../Interfaces/Chat'
import { Message } from '../../Interfaces/Message'
import { SessionInterface } from '../../Interfaces/SessionInterface'

type SessionEventType = 'added' | 'modified' | 'removed'

class ChatRealtimeGateway {
  private io: SocketIOServer | null = null
  private emitter = new EventEmitter()

  setSocketServer(io: SocketIOServer): void {
    this.io = io
  }

  emitChatUpsert(wpClientId: string, chat: Chat): void {
    this.io?.to(wpClientId).emit('whatsapp:chat-upsert', chat)
  }

  emitMessageCreated(wpClientId: string, chatId: string, message: Message): void {
    this.io?.to(wpClientId).emit('whatsapp:message-created', { chatId, message })
  }

  emitSessionEvent(type: SessionEventType, session: SessionInterface): void {
    this.io?.to(session.wp_client_id).emit(`whatsapp:session-${type}`, session)
    this.emitter.emit('session-event', { type, session })
  }

  onSessionEvent(listener: (type: SessionEventType, session: SessionInterface) => void): () => void {
    const handler = ({ type, session }: { type: SessionEventType; session: SessionInterface }) => {
      listener(type, session)
    }

    this.emitter.on('session-event', handler)

    return () => {
      this.emitter.off('session-event', handler)
    }
  }
}

export default new ChatRealtimeGateway()
