import {Database, Reference} from 'firebase-admin/database'
import Admin from './Admin'

class DatabaseService {
  public db: Database
  
  constructor() {
    this.db = Admin.getInstance().db
  }
  
  public dbServices(): Reference {
    return this.db.ref('services/')
  }

  public dbWpNotifications(): Reference {
    return this.db.ref('wp_notifications/')
  }
	
	public dbWpClients(): Reference {
		return this.db.ref('settings/wp_clients/')
	}
  
  public dbDrivers(): Reference {
    return this.db.ref('drivers/')
  }
	
	public dbConnectedDrivers(): Reference {
		return this.db.ref('online_drivers/')
	}
  
  public dbPlaces(): Reference {
    return this.db.ref('places/')
  }
  
  public dbClients(): Reference {
    return this.db.ref('clients/')
  }
}

export default new DatabaseService()