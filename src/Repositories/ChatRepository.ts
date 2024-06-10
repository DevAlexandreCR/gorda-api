import { Chat } from '../Interfaces/Chat'
import Firestore from '../Services/firebase/Firestore'

class ChatRepository {
  public getChats(listener: (chats: Chat[]) => void): void {
    Firestore.dbChats()
      .limit(100)
      .onSnapshot((snapshot) => {
        const chats: Chat[] = []
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const chat = change.doc.data() as Chat
            chats.push(chat)
          }
        })
        listener(chats)
      })
  }

  public async addChat(chat: Chat): Promise<Chat> {
    await Firestore.dbChats().doc(chat.id).set(chat)
    return Promise.resolve(chat)
  }
}

export default new ChatRepository()
