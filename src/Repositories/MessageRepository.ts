import { Message } from '../Interfaces/Message'
import Firestore from '../Services/firebase/Firestore'
import ChatRepository from './ChatRepository'

class MessageRepository {
  public getMessages(
    wpClientId: string,
    chatId: string,
    listener: (messages: Message[]) => void
  ): void {
    Firestore.dbMessages(wpClientId, chatId)
      .limit(100)
      .onSnapshot((snapshot) => {
        const messages: Message[] = []
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const message = change.doc.data() as Message
            messages.push(message)
          }
        })
        listener(messages)
      })
  }

  public async addMessage(wpClientId: string, chatId: string, message: Message): Promise<void> {
    await Firestore.dbMessages(wpClientId, chatId).doc(message.id).set(message)
    await ChatRepository.updateChat(wpClientId, chatId, message)
    return Promise.resolve()
  }
}

export default new MessageRepository()
