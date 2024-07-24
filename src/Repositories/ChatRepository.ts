import { Chat } from '../Interfaces/Chat'
import Firestore from '../Services/firebase/Firestore'
import {Message} from '../Interfaces/Message'
import DateHelper from '../Helpers/DateHelper'

class ChatRepository {
  public getChats(wpClientId: string, listener: (chats: Chat[]) => void): void {
    Firestore.dbChats(wpClientId)
      .limit(100)
      .orderBy('updated_at', 'desc')
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

  public async updateChat(wpClientId: string, chatId: string, message: Message): Promise<void> {
    await Firestore.dbChats(wpClientId).doc(chatId).update({
      updated_at: DateHelper.unix(),
      lastMessage: message,
      archived: false,
    } as Partial<Chat>)
    return Promise.resolve()
  }

  public async addChat(wpClientId: string, chat: Chat): Promise<Chat> {
    await Firestore.dbChats(wpClientId).doc(chat.id).set(chat)
    return Promise.resolve(chat)
  }
}

export default new ChatRepository()
