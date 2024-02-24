import Admin from './Admin'
import {firestore} from 'firebase-admin'
import Firestore = firestore.Firestore
import CollectionReference = firestore.CollectionReference

class FirestoreService {
  public fs: Firestore
  
  constructor() {
    this.fs = Admin.getInstance().fs
  }
  
  public dbSessions(): CollectionReference {
    return this.fs.collection('sessions')
  }
}

export default new FirestoreService()