import {Database, Reference} from 'firebase-admin/database'
import Admin from './Admin'

class DatabaseService {
  public db: Database
  
  constructor() {
    this.db = Admin.getInstance().db
  }
  
  public dbSessions(): Reference {
    return this.db.ref('sessions/')
  }
  
  public dbServices(): Reference {
    return this.db.ref('services/')
  }
  
  public dbDrivers(): Reference {
    return this.db.ref('drivers/')
  }
  
  public dbPlaces(): Reference {
    return this.db.ref('places/')
  }
}

export default new DatabaseService()