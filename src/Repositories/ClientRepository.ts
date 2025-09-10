import DBService from '../Services/firebase/Database'
import Client from '../Models/Client'
import { ClientInterface } from '../Interfaces/ClientInterface'
import Database from '../Services/firebase/Database'
import config from '../../config'
import * as Sentry from '@sentry/node'
import { WpContactInterface } from '../Services/whatsapp/interfaces/WpContactInterface'

class ClientRepository {
  /* istanbul ignore next */
  onClient(
    AddListener: (client: Client) => void,
    deleteListener: (clientId: string | false) => void
  ): void {
    DBService.dbClients().on('child_added', (snapshot) => {
      const client = snapshot.val() as ClientInterface
      const clientTmp = new Client()
      Object.assign(clientTmp, client)
      AddListener(clientTmp)
    })

    DBService.dbClients().on('child_removed', (snapshot) => {
      if (!snapshot.key) return false
      const client = snapshot.val() as ClientInterface
      deleteListener(client.id)
    })
  }

  public async create(contact: WpContactInterface): Promise<ClientInterface> {
    const newClient: Client = new Client()
    newClient.id = contact.id
    newClient.name = contact.pushname ?? contact.pushname
    newClient.phone = `+${contact.number}`
    newClient.photoUrl = await contact.getProfilePicUrl()
    if (!newClient.photoUrl) newClient.photoUrl = config.DEFAULT_CLIENT_PHOTO_URL
    await Database.dbClients()
      .child(contact.number)
      .set(newClient)
      .catch((e) => Sentry.captureException(e))
    return newClient
  }
}

export default new ClientRepository()
