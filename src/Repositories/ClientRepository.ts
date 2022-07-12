import DBService from '../Services/firebase/Database'
import Client from '../Models/Client'
import {ClientInterface} from '../Interfaces/ClientInterface'
import Database from '../Services/firebase/Database'
import {Contact} from 'whatsapp-web.js'
import config from '../../config'

class ClientRepository {
  
  /* istanbul ignore next */
  getAll(listener: (client: Client)=> void): void {
    DBService.dbClients().on('child_added', (snapshot) => {
      const client = snapshot.val() as ClientInterface
      const clientTmp = new Client
      Object.assign(clientTmp, client)
      listener(clientTmp)
    })
  }
  
  public async create(contact: Contact): Promise<ClientInterface> {
    const newClient: Client = new Client
    newClient.id = contact.id._serialized
    newClient.name = contact.name?? contact.pushname
    newClient.phone = `+${contact.number}`
    newClient.photoUrl = await contact.getProfilePicUrl()
    if (!newClient.photoUrl) newClient.photoUrl = config.DEFAULT_CLIENT_PHOTO_URL
    await Database.dbClients().child(contact.number).set(newClient).catch(e => console.log(e))
    return newClient
  }
}

export default new ClientRepository()