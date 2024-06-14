import { Chat } from '../Interfaces/Chat'
import Firestore from '../Services/firebase/Firestore'

class ChatRepository {
  public getChats(wpClientId: string, listener: (chats: Chat[]) => void): void {
    Firestore.dbChats(wpClientId)
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

  public async addChat(wpClientId: string, chat: Chat): Promise<Chat> {
    await Firestore.dbChats(wpClientId).doc(chat.id).set(chat)
    return Promise.resolve(chat)
  }
}

export default new ChatRepository()
