import MessageHelper from '../../Helpers/MessageHelper'
import { Locale } from '../../Helpers/Locale'
import { Store } from '../store/Store'
import { MessagesEnum } from './MessagesEnum'
import { getPlaceholders, Placeholders, replacePlaceholders } from './Placeholders'
import { ChatBotMessage } from '../../Types/ChatBotMessage'

export interface VehicleSnapshot {
  plate: string
  color: { name: string; hex?: string } | null
}

function getStore(): Store {
  return Store.getInstance()
}

export function getSingleMessage(messagesEnum: MessagesEnum): ChatBotMessage {
  return getStore().findMessageById(messagesEnum)
}

const locale = Locale.getInstance()

export const requestingService = (placeName: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.PLACE, placeName)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.REQUESTING_SERVICE)
  return replacePlaceholders(message, placeholdersMap)
}

export const askForLocation = (name: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.ASK_FOR_LOCATION)
  return replacePlaceholders(message, placeholdersMap)
}

export const completedService = (): ChatBotMessage => {
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.SERVICE_COMPLETED)
  return replacePlaceholders(message, getPlaceholders())
}
export const serviceAssigned = (vehicle: VehicleSnapshot): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.PLATE, MessageHelper.truncatePlate(vehicle.plate))
  placeholdersMap.set(Placeholders.COLOR, locale.__('colors.' + (vehicle.color?.name ?? '')))
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.SERVICE_ASSIGNED)
  return replacePlaceholders(message, placeholdersMap)
}

export const greeting = (name: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.GREETING)
  return replacePlaceholders(message, placeholdersMap)
}

const newClientGreeting = (name: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.GREETING_NEW_USERS)
  return replacePlaceholders(message, placeholdersMap)
}

export const greetingNews = (name: string): ChatBotMessage => {
  return newClientGreeting(name)
}

export const newClientAskPlaceName = (name: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.NEW_USER_ASK_FOR_PLACE)
  return replacePlaceholders(message, placeholdersMap)
}

export const newClientAskForComment = (name: string, place: string): ChatBotMessage => {
  const placeholdersMap = getPlaceholders()
  placeholdersMap.set(Placeholders.PLACE, place)
  placeholdersMap.set(Placeholders.USERNAME, name)
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.NEW_USER_ASK_FOR_COMMENT)
  return replacePlaceholders(message, placeholdersMap)
}

export const serviceInProgress = (): ChatBotMessage => {
  const store = getStore()
  const message = store.findMessageById(MessagesEnum.SERVICE_IN_PROGRESS)
  return replacePlaceholders(message, getPlaceholders())
}
