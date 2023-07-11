import Database from '../Services/firebase/Database'
import {SessionInterface} from '../Interfaces/SessionInterface'
import {DataSnapshot} from 'firebase-admin/database'
import Session from '../Models/Session'
import {Message, MessageTypes} from 'whatsapp-web.js'

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
}

export default new SessionRepository()