import Vehicle from '../../Models/Vehicle'
import MessageHelper from '../../Helpers/MessageHelper'
import {Locale} from '../../Helpers/Locale'
import {PlaceOption} from '../../Interfaces/PlaceOption'
import {Store} from '../store/Store'
import {MessagesEnum} from './MessagesEnum'
import {Placeholders, replacePlaceholders} from './Placeholders'

const locale = Locale.getInstance()
const store = Store.getInstance()

export const requestingService = (placeName: string): string => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.PLACE, placeName)
  return  replacePlaceholders(store.findMessageById(MessagesEnum.REQUESTING_SERVICE).message, placeholdersMap)
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
export const serviceAssigned = (vehicle: Vehicle): string => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.PLATE, MessageHelper.truncatePlate(vehicle.plate))
  placeholdersMap.set(Placeholders.COLOR, locale.__('colors.' + vehicle.color.name))
  return  replacePlaceholders(store.findMessageById(MessagesEnum.SERVICE_ASSIGNED).message, placeholdersMap)
}
export const greeting = (name: string): string => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.USERNAME, name)
  return  replacePlaceholders(store.findMessageById(MessagesEnum.GREETING).message, placeholdersMap)
}

const newClientGreeting = (name: string): string => {
  const placeholdersMap = new Map<Placeholders, string>()
  placeholdersMap.set(Placeholders.USERNAME, name)
  return  replacePlaceholders(store.findMessageById(MessagesEnum.GREETING_NEW_USERS).message, placeholdersMap)
}

export const greetingNews = (name: string): string => {
  return newClientGreeting(name)
}
export const newClientAskPlaceName = (name: string): string => {
  const greeting = newClientGreeting(name)
  return `${greeting} \n\n${store.findMessageById(MessagesEnum.ASK_FOR_LOCATION_NAME)}`
}

export const newClientAskForComment = (name: string, place: string): string => {
  const greeting = newClientGreeting(name)
  const placeName = requestingService(place)
  return `${greeting} \n\n${placeName}`
}
