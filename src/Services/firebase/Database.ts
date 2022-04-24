import {Database, Reference, getDatabase} from 'firebase-admin/database'
import Admin from './Admin'

class DatabaseService {
  public db: Database
  
  constructor() {
    this.db = getDatabase(Admin.getInstance())
  }
  
  public dbSessions(): Reference {
    return this.db.ref('sessions/')
  }
  
  public dbServices(): Reference {
    return this.db.ref('services/')
  }
}

export default new DatabaseService()