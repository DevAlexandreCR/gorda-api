import Vehicle from '../../Models/Vehicle'
import MessageHelper from '../../Helpers/MessageHelper'
import {Locale} from '../../Helpers/Locale'
import {PlaceOption} from '../../Interfaces/PlaceOption'
import {Store} from '../store/Store'
import {MessagesEnum} from './MessagesEnum'
import {Placeholders, replacePlaceholders} from './Placeholders'
import {ChatBotMessage} from '../../Types/ChatBotMessage'
import config from '../../../config'

export function getSingleMessage(messagesEnum: MessagesEnum): ChatBotMessage {
  return store.findMessageById(messagesEnum)
}


const locale = Locale.getInstance()
const store = Store.getInstance()

export const requestingService = (placeName: string): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.PLACE, placeName)
  const message = store.findMessageById(MessagesEnum.REQUESTING_SERVICE)
  message.message = replacePlaceholders(message.message, placeholdersMap)
  return message
}

export const cancelService = (serviceID: string): string => {
  return 'Si deseas cancelar reenvíanos éste mensaje \n' +

  `Cancelar servicio convenio id=${serviceID}`
}
export const sendPlaceOptions = (options: Array<PlaceOption>, resend: boolean = false): string => {
  const error = 'No reconocimos ninguna opción válida, '
  const found = 'Encontramos éstas coincidencias, '
  const message = 'envía el número de la opción correcta o puedes enviar tu ubicación actual: \n'
  let optionsMessage = ''
  options.forEach((opt) => {
    const place = store.findPlaceById(opt.placeId)
    optionsMessage += `*${opt.option}* ${place?.name} \n`
  })
  optionsMessage += `*${options.length + 1}* ${store.findMessageById(MessagesEnum.NONE_OF_THE_ABOVE)}`
  if (resend) return error + message + optionsMessage
  return found + message + optionsMessage
}

export const serviceAssigned = (vehicle: Vehicle): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.PLATE, MessageHelper.truncatePlate(vehicle.plate))
  placeholdersMap.set(Placeholders.COLOR, locale.__('colors.' + vehicle.color.name))
  const message = store.findMessageById(MessagesEnum.SERVICE_ASSIGNED)
  message.message = replacePlaceholders(message.message, placeholdersMap)
  return message
}

export const greeting = (name: string): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const message = store.findMessageById(MessagesEnum.GREETING)
  message.message = replacePlaceholders(store.findMessageById(MessagesEnum.GREETING).message, placeholdersMap)
  return message
}

const newClientGreeting = (name: string): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.USERNAME, name)
  placeholdersMap.set(Placeholders.COMPANY, config.APP_NAME)
  const message = store.findMessageById(MessagesEnum.GREETING_NEW_USERS)
  message.message = replacePlaceholders(store.findMessageById(MessagesEnum.GREETING_NEW_USERS).message, placeholdersMap)
  return message
}

export const greetingNews = (name: string): ChatBotMessage => {
  return newClientGreeting(name)
}

export const newClientAskPlaceName = (name: string): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.USERNAME, name)
  const message = store.findMessageById(MessagesEnum.NEW_USER_ASK_FOR_PLACE)
  message.message = replacePlaceholders(store.findMessageById(MessagesEnum.NEW_USER_ASK_FOR_PLACE).message, placeholdersMap)
  return message
}

export const newClientAskForComment = (name: string, place: string): ChatBotMessage => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.PLACE, place)
  placeholdersMap.set(Placeholders.USERNAME, name)
  const message = store.findMessageById(MessagesEnum.NEW_USER_ASK_FOR_COMMENT)
  message.message = replacePlaceholders(message.message, placeholdersMap)

  return message
}
