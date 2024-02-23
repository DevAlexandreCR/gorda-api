import Database from '../Services/firebase/Database'
import {SessionInterface} from '../Interfaces/SessionInterface'
import {DataSnapshot} from 'firebase-admin/database'
import Session from '../Models/Session'
import {Message, MessageTypes} from 'whatsapp-web.js'
import {WpMessage} from '../Types/WpMessage'

class SessionRepository {
  
  public async findSessionByChatId(chatId: string): Promise<SessionInterface | null> {
    let val: SessionInterface | null = null
    const snapshot: DataSnapshot = await Database.dbSessions().orderByChild('chat_id')
      .equalTo(chatId).limitToLast(1).once('value')
    snapshot.forEach(snapshot => {
      const session = <SessionInterface>snapshot.val()
      if (session.status != Session.STATUS_COMPLETED) val = session
    })
    return val
  }
  
  public async update(session: SessionInterface): Promise<SessionInterface> {
    await Database.dbSessions().child(session.id).set(session)
    return session
  }

  public async updateStatus(session: SessionInterface): Promise<SessionInterface> {
    await Database.dbSessions().child(session.id).child('status').set(session.status)
    return session
  }

  public async updateService(session: SessionInterface): Promise<SessionInterface> {
    await Database.dbSessions().child(session.id).child('service_id').set(session.service_id)
    return session
  }

  public async updatePlace(session: SessionInterface): Promise<SessionInterface> {
    await Database.dbSessions().child(session.id).child('place').set(session.place)
    return session
  }

  public async updatePlaceOptions(session: SessionInterface): Promise<SessionInterface> {
    await Database.dbSessions().child(session.id).child('placeOptions').set(session.placeOptions)
    return session
  }
  
  public async create(session: SessionInterface): Promise<SessionInterface> {
    const res = await Database.dbSessions().push(session)
    session.id = res.key!
    return this.update(session)
  }

  public async getAbandonedSessions(): Promise<Array<SessionInterface>> {
    const res = await Database.dbSessions().orderByChild('status').equalTo(Session.STATUS_ASKING_FOR_PLACE).get()
    const sessions = Array<SessionInterface>()
    res.forEach(snapshot => {
      const session = <SessionInterface>snapshot.val()
      sessions.push(session)
    })
    return sessions
  }

  public async closeAbandoned(sessions: Array<SessionInterface>): Promise<void> {
    const sessionsObject: Record<string, any> = {}
    sessions.forEach((session) => {
      sessionsObject[session.id + '/status'] = Session.STATUS_COMPLETED
    })
    await Database.dbSessions().update(sessionsObject)
  }
	
	public async addChat(msg: Message) : Promise<void> {
		if (msg.type === MessageTypes.TEXT) {
			await Database.db.ref('chats').child(msg.from.replace(/\D/g, '')).push(msg.body)
		}
	}

  public async addMsg(sessionId: string, msg: WpMessage) : Promise<string> {
    const ref = Database.dbSessions().child(sessionId).child('messages').push()
    return await ref.set(msg).then(() => Promise.resolve(ref.key!!)).catch((e) => Promise.resolve(e))
  }

  public async setProcessedMsg(sessionId: string, msgKey: string) : Promise<void> {
    await Database.dbSessions().child(sessionId).child('messages').child(msgKey).child('processed').set(true)
  }

  public async getUnprocessedMsgs(sessionId: string) : Promise<Map<string, WpMessage>> {
    const messages = new Map<string, WpMessage>()
    await Database.dbSessions().child(sessionId).child('messages')
    .orderByChild('processed')
    .equalTo(false)
    .once('value', (dataSnapshot) =>{
      dataSnapshot.forEach(snapshot => {
        if(snapshot.key) messages.set(snapshot.key, snapshot.val())
      })
    })

    return messages
  }
}

export default new SessionRepository()