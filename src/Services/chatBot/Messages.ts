import config from '../../../config'
export const requestingService = (placeName: string): string => {
  return  'Lugar: *' + placeName + REQUESTING_SERVICE
}
export const serviceAssigned = (plate: string): string => {
  return `El Móvil 🚘  ${plate} 🚗 ${SERVICE_ASSIGNED}`
}
export const ASK_FOR_NEIGHBORHOOD = 'Confirma por favor el lugar donde te' +
  ' encuentras para asignarte un vehículo en el menor tiempo posible, ejemplo: \n' +
  '- *Barrio* Centro \n' +
  '- *Conjunto* Torres del bosque \n' +
  '- *CC* Campanario \n' +
  '- *CC* Hospital San Jose \n' +
  '- *CC* Hotel San Martin \n' +
  '- *Urbanización* La Villa \n' +
  'O también puedes enviar tu ubicación 📍'
export const REQUESTING_SERVICE = '* Creando servicio...'
export const WELCOME = 'Hola 🙋🏻‍♀ te has comunicado con *RED BLANCA POPAYÁN ✨ ' + ASK_FOR_NEIGHBORHOOD
export const CANCELED = 'Tu servicio ha sido cancelado correctamente, gracias por usar nuestros servicios.'

export const NON_NEIGHBORHOOD_FOUND = 'No logramos identificar el lugar donde te encuentras por favor vuelve a intentarlo. \n' +
  ASK_FOR_NEIGHBORHOOD
export const ASK_FOR_DRIVER = 'El servicio se creó correctamente, en cuanto un conductor se reporte te estaremos ' +
  'informando, por favor espera unos segundos...'
export const ASK_FOR_CANCEL_WHILE_FIND_DRIVER = 'Estamos buscando un conductor, en cuanto un conductor se reporte te '+
  'informaremos. Por favor espera unos segundos. si deseas cancelar el servicio envía *CANCELAR*'
export const ERROR_CREATING_SERVICE = 'No pudimos crear el servicio, por favor intenta ms tarde. lamentamos las molestias'
export const SERVICE_IN_PROGRESS = 'Tienes un servicio en progreso para reportar una queja comunicate al ' + config.PQR_NUMBER
export const SERVICE_ASSIGNED = 'en un momento se comunica contigo. Recuerda verificar tus pertenencias antes de bajarte del vehículo\n'
export const SERVICE_COMPLETED = `Esperamos hayas disfrutado tu viaje, si tienes alguna sugerencia por favor escribe al ${config.PQR_NUMBER}\n\n` +
  'GRACIAS POR CONFIAR EN RED BLANCA POPAYÁN❣️✨'
