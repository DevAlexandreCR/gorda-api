import { ClientInterface } from '../Interfaces/ClientInterface'

export default class Client implements ClientInterface {
  public id: string
  public name: string
  public phone: string
  public photoUrl: string
}
