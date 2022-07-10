import {initializeApp, App, applicationDefault} from 'firebase-admin/app'
import {Database, getDatabase} from 'firebase-admin/database'
import {Auth, getAuth} from 'firebase-admin/auth'
import config from '../../../config'

export default class Admin {
  public static instance: Admin
  public app: App
  public auth: Auth
  public db: Database
  
  constructor() {
    this.app = initializeApp({
      credential: applicationDefault(),
      databaseURL: config.FIREBASE_DATABASE_URL,
    })
    this.db = getDatabase(this.app)
    this.auth = getAuth(this.app)
    if (config.NODE_ENV == 'local') {
      this.db.useEmulator('localhost', 9000)
    }
  }
  
  public static getInstance(): Admin {
    if (!Admin.instance) {
      Admin.instance = new Admin()
    }
    return Admin.instance
  }
}