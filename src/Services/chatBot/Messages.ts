import config from '../../../config'
import Vehicle from '../../Models/Vehicle'
import MessageHelper from '../../Helpers/MessageHelper'
import {Locale} from '../../Helpers/Locale'
import {PlaceOption} from '../../Interfaces/PlaceOption'
import {Store} from '../store/Store'

const locale = Locale.getInstance()
const store = Store.getInstance()

export const requestingService = (placeName: string): string => {
  return  'Lugar: *' + placeName + REQUESTING_SERVICE
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
  optionsMessage += `*${options.length + 1}* ${NONE_OF_THE_ABOVE}`
  if (resend) return error + message + optionsMessage
  return found + message + optionsMessage
}
export const serviceAssigned = (vehicle: Vehicle): string => {
  return `El Móvil 🚘  *${MessageHelper.truncatePlate(vehicle.plate)}* color ${locale.__('colors.' + vehicle.color.name)} ${SERVICE_ASSIGNED}`
}
export const welcome = (name: string): string => {
  return `Hola 🙋🏻‍♀ *${name}*  ${WELCOME}`
}
export const BAD_AGREEMENT = 
  'No logramos reconocer el lugar del convenio, por favor verifica que esté bien escrito, ejemplo:\n \n' +
  'Movil convenio Campanario \n' +
  'Movil con bodega amplia convenio Monte Luna \n \n' +
  `o escríbenos al ${config.PQR_NUMBER} para agregarlo.`

export const welcomeNews = (name: string): string => {
  return `Hola *${name}* 🙋🏻‍♀ Bienvenido a *RED BLANCA POPAYÁN ✨* ${WELCOME}`
}
export const NONE_OF_THE_ABOVE = 'Ninguna de las anteriores'
export const SERVICE_NOT_FOUND = 'No se encontró el servicio que desea cancelar.'
export const ASK_FOR_NEIGHBORHOOD = 'Confirma por favor el lugar donde te' +
  ' encuentras para asignarte un vehículo en el menor tiempo posible, ejemplo: \n' +
  '- _Centro_ \n' +
  '- _Torres del bosque_ \n' +
  '- _CC Campanario_ \n \n' +
  '*O también puedes enviar tu ubicación 📍*'
export const REQUESTING_SERVICE = '* Creando servicio...\n \n' +
  'Para agregar un comentario tipo: \n*Sin acompañante* \n*Con mascota* o \n*Bodega amplia* \nPor favor escríbelo abajo, de lo contrario envía *NO*'
export const WELCOME = '¿Para dónde vamos hoy? \n \n' + ASK_FOR_NEIGHBORHOOD
export const CANCELED = 'se ha cancelado tu solicitud! 🥹\n' +
  '*Espero poder colaborarte en una próxima ocasión 🙋🏻‍♀️*'

export const NON_NEIGHBORHOOD_FOUND = 'No logramos identificar el lugar donde te encuentras por favor vuelve a intentarlo. \n' +
  ASK_FOR_NEIGHBORHOOD
export const ASK_FOR_DRIVER = 'Con gusto! en un momento te confirmaremos cual fue el vehículo asignado. \n \n' +
  '*Recuerda que esto puede tardar de 2 a 5min ⌛Agradecemos tu paciencia!!💕*'
export const ASK_FOR_CANCEL_WHILE_FIND_DRIVER = 'Estamos buscando un conductor, en cuanto un conductor se reporte te '+
  'informaremos. Esto tardara algunos minutos!⏳ .\nSi deseas cancelar el servicio envía *CANCELAR*'
export const ERROR_CREATING_SERVICE = 'No pudimos crear el servicio, por favor intenta ms tarde. lamentamos las molestias'
export const SERVICE_IN_PROGRESS = 'Tienes un servicio en progreso para reportar una queja comunicate al ' + config.PQR_NUMBER + '\n'
export const SERVICE_ASSIGNED = ' 👈🏻en un momento se comunica contigo!🫶🏻\n \n' +
  '_Recuerda verificar tus pertenencias antes de bajarte del vehículo._\n \n' +
	'_Ten en cuenta nuestras tarifas cambiaron, ahora la mínima 5.000 en el día y 5.500 en la noche_ 💕 \n \n' +
  '*GRACIAS POR CONFIAR EN RED BLANCA POPAYÁN❣️✨*'
export const MESSAGE_TYPE_NOT_SUPPORTED = 'Por favor intenta nuevamente con un mensaje válido.\n'
export const SERVICE_COMPLETED = 'Gracias por confiar en *RED BLANCA POPAYÁN💫💞* \n \nSi quieres presentar una solicitud queja o reclamo! ' +
  `Escribe al ${config.PQR_NUMBER}\n` +
  'Con gusto te atenderemos.'
export const ASK_FOR_NAME = 'Hola 🙋🏻‍♀ te has comunicado con *RED BLANCA POPAYÁN ✨* por favor dime tu nombre para una atención personalizada. ejemplo: \n' +
  '*Pepito Perez*\n' +
  '*Maria Paz*'
export const DRIVER_ARRIVED = '¡Tu conductor ha llegado! 🏠🚗'
export const PING = 'WP running!'
export const ASK_FOR_CANCEL_WHILE_WAIT_DRIVER = 'Tu conductor está en camino '+
  'por favor espera unos segundos. \nSi deseas cancelar el servicio envía *CANCELAR*'
