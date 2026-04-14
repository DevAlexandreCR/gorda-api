import Container from '../Container/Container'
import { ClientDictionary } from '../Interfaces/ClientDiccionary'
import { WpClient } from '../Interfaces/WpClient'
import { ChatBotMessage } from '../Types/ChatBotMessage'
import { MessagesEnum } from '../Services/chatBot/MessagesEnum'
import { Branch } from '../Interfaces/Branch'
import { LatLng } from '../Interfaces/LatLng'
import { RideFeeInterface } from '../Types/RideFeeInterface'

class SettingsRepository {
  async enableWpNotifications(clientId: string, enable: boolean): Promise<void> {
    await Container.getMasterDataRepository().updateWpClient(clientId, {
      wpNotifications: enable,
    })
  }

  getWpClients(listener: (clients: ClientDictionary) => void): void {
    Container.getMasterDataRepository()
      .listWpClients()
      .then((wpClients) => {
        const clients: ClientDictionary = {}
        wpClients.forEach((client: WpClient) => {
          clients[client.id] = client
        })
        listener(clients)
      })
      .catch((error) => {
        console.error('Error loading wp clients from SQL:', error)
        listener({})
      })
  }

  getChatBotMessages(listener: (messages: Map<MessagesEnum, ChatBotMessage>) => void): void {
    Container.getMasterDataRepository()
      .getChatBotMessagesMap()
      .then((messages) => {
        listener(messages)
      })
      .catch((error) => {
        console.error('Error loading chatbot messages from SQL:', error)
        listener(new Map())
      })
  }

  getBranches(listener: (branches: Branch[]) => void): void {
    Container.getMasterDataRepository()
      .getBranches()
      .then((branches) => {
        listener(branches)
      })
      .catch((error) => {
        console.error('Error loading branches from SQL:', error)
        listener([])
      })
  }

  async getFees(): Promise<RideFeeInterface> {
    return Container.getMasterDataRepository().buildPricingSnapshot()
  }

  async setMinFee(fee: number): Promise<void> {
    const rideFees = await Container.getMasterDataRepository().getRideFees()
    await Container.getMasterDataRepository().updateRideFees({
      ...rideFees,
      fees_minimum: fee,
    })
  }

  async setMultiplier(fee: number): Promise<void> {
    const rideFees = await Container.getMasterDataRepository().getRideFees()
    await Container.getMasterDataRepository().updateRideFees({
      ...rideFees,
      fee_multiplier: fee,
    })
  }

  async setCoordinates(
    branchId: string,
    cityId: string,
    coordinates: Array<LatLng>
  ): Promise<void> {
    await Container.getMasterDataRepository().updateCityPolygon(branchId, cityId, coordinates)
  }
}
export default new SettingsRepository()
