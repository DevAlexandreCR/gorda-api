import Database from '../Services/firebase/Database'
import {SessionInterface} from '../Interfaces/SessionInterface'
import {DataSnapshot} from 'firebase-admin/database'
import Session from '../Models/Session'

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
}

export default new SessionRepository()