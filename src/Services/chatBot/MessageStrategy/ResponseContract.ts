import Session from '../../../Models/Session'
import {Client, Message, MessageContent, MessageTypes} from 'whatsapp-web.js'
import {Store} from '../../store/Store'
import CurrentClient from '../../../Models/Client'

export abstract class ResponseContract {
  
  protected store: Store = Store.getInstance()
  protected currentClient: CurrentClient
  
  abstract processMessage(client: Client, session: Session, message: Message): Promise<void>
  
  isChat(message: Message): boolean {
    return message.type === MessageTypes.TEXT
  }
  
  isLocation(message: Message): boolean {
    return message.type === MessageTypes.LOCATION
  }
  
  async sendMessage(client: Client, chatId: string, content: MessageContent): Promise<void> {
    await client.sendMessage(chatId, content).catch(e => console.log(e))
  }
  
  setCurrentClient(message: Message): void {
    const client = this.store.findClientById(message.from)
    if (client) this.currentClient = client
    else {
      message.getContact().then(contact => {
        this.currentClient = new CurrentClient()
        this.currentClient.name = contact.name?? contact.number
        this.currentClient.phone = contact.number
      })
    }
  }
  
  clientExists(message: Message): boolean {
    const client = this.store.findClientById(message.from)
    if (client) this.currentClient = client
    return client != undefined
  }
}