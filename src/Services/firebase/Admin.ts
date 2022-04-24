import {initializeApp, App, ServiceAccount, cert} from 'firebase-admin/app'
import {getDatabase} from 'firebase-admin/database'

export default class Admin {
  private static app: App
  
  public static getInstance(): App {
    if (!Admin.app) {
      const serviceAccount: ServiceAccount = require("/home/alexandrecr/devs/gorda/firebaseAccount.json");
      Admin.app = initializeApp({
          credential: cert(serviceAccount),
          databaseURL: 'https://gorda-driver-default-rtdb.firebaseio.com'
        })
      const db = getDatabase(Admin.app)
      if (process.env.NODE_ENV !== 'production') {
        db.useEmulator('localhost', 9000)
      }
    }
    return Admin.app
  }
}