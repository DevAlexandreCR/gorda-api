import Database from '../Services/firebase/Database'
import {SessionInterface} from '../Interfaces/SessionInterface'
import Session from '../Models/Session'
import {Message, MessageTypes} from 'whatsapp-web.js'
import {WpMessage} from '../Types/WpMessage'
import Firestore from '../Services/firebase/Firestore'
import {WpNotifications} from '../Types/WpNotifications'

class SessionRepository {
  
  public async findSessionByChatId(chatId: string): Promise<SessionInterface | null> {
    let val: SessionInterface | null = null
    const snapshot = await Firestore.dbSessions()
    .where('chat_id', '==', chatId)
    .where('status', 'not-in', [Session.STATUS_COMPLETED])
    .orderBy('status')
    .orderBy('chat_id')
    .limit(1)
    .get()
    snapshot.forEach(snapshot => {
      val = <SessionInterface>snapshot.data()
    })
    return val
  }
  
  public async updateId(session: SessionInterface): Promise<SessionInterface> {
    await Firestore.dbSessions().doc(session.id).set({
      id: session.id
    })
    return session
  }

  public async getMessages(sessionId: string): Promise<Map<string, WpMessage>> {
    const messages: Map<string, WpMessage> = new Map()
    await Firestore.dbSessions()
      .doc(sessionId)
      .collection('messages')
      .orderBy('created_at')
      .get().then(data => {
      data.forEach(snapshot => {
        messages.set(snapshot.id, <WpMessage>snapshot.data())
      })
    })

    return messages
  }

  public async updateStatus(session: SessionInterface): Promise<SessionInterface> {
    await Firestore.dbSessions().doc(session.id).update({
      status: session.status
    })
    return session
  }

  public async updateService(session: SessionInterface): Promise<SessionInterface> {
    await Firestore.dbSessions().doc(session.id).update({
      service_id: session.service_id
    })
    return session
  }

  public async updatePlace(session: SessionInterface): Promise<SessionInterface> {
    await Firestore.dbSessions().doc(session.id).update({
      place: {...session.place}
    })
    return session
  }

  public async updatePlaceOptions(session: SessionInterface): Promise<SessionInterface> {
    await Firestore.dbSessions().doc(session.id).update({
      placeOptions: session.placeOptions
    })
    return session
  }

  public async updateNotification(sessionId: string, notifications: WpNotifications): Promise<void> {
    await Firestore.dbSessions().doc(sessionId).update({
      notifications: notifications
    })
  }
  
  public async create(session: SessionInterface): Promise<SessionInterface> {
    const res = Firestore.dbSessions().doc()
    session.id = res.id
    const sessionData = {...session}
    delete sessionData.messages
    await res.create({...sessionData}).catch(e => console.log(e))

    return session
  }

  public async getActiveSessions(): Promise<Array<SessionInterface>> {
    const res = await Firestore.dbSessions()
    .orderBy('status')
    .where('status', 'not-in', [Session.STATUS_COMPLETED])
    .get()
    const sessions = Array<SessionInterface>()
    res.docs.forEach(snapshot => {
      const session = <SessionInterface>snapshot.data()
      sessions.push(session)
    })
    return sessions
  }

  public sessionActiveListener(wpClientId: string, listener: (type: string, session: Session) => void): void {
    Firestore.dbSessions()
    .where('status', 'not-in', [Session.STATUS_COMPLETED])
    .where('wp_client_id', '==', wpClientId)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const sessionInterface = <SessionInterface>change.doc.data()
        const session = new Session(sessionInterface.chat_id)
        Object.assign(session, sessionInterface)
        listener(change.type, session)
      })
    })
  }

  public async closeAbandoned(sessions: Array<SessionInterface>): Promise<void> {
    const batch = Firestore.fs.batch()
    sessions.forEach((session) => {
      const sessionRef = Firestore.dbSessions().doc(session.id)
      batch.update(sessionRef, {status: Session.STATUS_COMPLETED})
    })
    await batch.commit()
  }
	
	public async addChat(msg: Message) : Promise<void> {
		if (msg.type === MessageTypes.TEXT) {
			await Database.db.ref('chats').child(msg.from.replace(/\D/g, '')).push(msg.body)
		}
	}

  public async addMsg(sessionId: string, msg: WpMessage) : Promise<string> {
    const ref = Firestore.dbSessions()
      .doc(sessionId)
      .collection('messages')
      .doc(msg.id)
    return await ref.create({...msg}).then(() => Promise.resolve(ref.id)).catch((e) => Promise.resolve(e))
  }

  public async setProcessedMsgs(sessionId: string, msgs: WpMessage[]) : Promise<void> {
    const batch = Firestore.fs.batch()
    msgs.forEach((msg) => {
      const msgRef = Firestore.dbSessions().doc(sessionId)
      .collection('messages').doc(msg.id)

      batch.update(msgRef, {processed: true})
    })
    await batch.commit()
  }
}

export default new SessionRepository()