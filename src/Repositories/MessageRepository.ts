import { Message } from '../Interfaces/Message'
import Firestore from '../Services/firebase/Firestore'

class MessageRepository {
  public getMessages(chatId: string, listener: (messages: Message[]) => void): void {
    Firestore.dbMessages(chatId)
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

  public async addMessage(chatId: string, message: Message): Promise<void> {
    await Firestore.dbMessages(chatId).doc(message.id).set(message)
    return Promise.resolve()
  }
}

export default new MessageRepository()
