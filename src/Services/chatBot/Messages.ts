export const requestingService = (neighborhood: string): string => {
  return  'Barrio *' + neighborhood + REQUESTING_SERVICE
}
export const REQUESTING_SERVICE = '* Creando servicio...'
export const WELCOME = 'Hola 🙋🏻‍♀ te has comunicado con *RED BLANCA POPAYÁN ✨ Confirma por favor BARRIO* donde te encuentras para asignarte un vehículo en el menor tiempo posible 💞 ejemplo: \n barrio -Centro-'
export const CANCELED = 'Tu servicio ha sido cancelado correctamente, gracias por usar nuestros servicios.'
export const ASK_FOR_NEIGHBORHOOD = 'Confirma por favor el BARRIO* donde te encuentras para asignarte un vehículo en el menor tiempo posible 💞 ejemplo: \n barrio -Centro-'
export const NON_NEIGHBORHOOD_FOUND = 'No logramos identificar el barrio por favor vuelve a escribirlo, no olvides encerrarlo entre - ejemplo *barrio -Centro-*'
export const ASK_FOR_DRIVER = 'El servicio se creó correctamente, en cuanto un conductor se reporte te estaremos informando \n por favor espera unos segundos...'
export const ASK_FOR_CANCEL_WHILE_FIND_DRIVER = 'Estamos buscando un conductor, en cuanto un conductor se reporte te estaremos informando \n por favor espera unos segundos. si deseas cancelar el servicio envía *CANCELAR*'
export const ERROR_CREATING_SERVICE = 'No pudimos crear el servicio, por favor intenta ms tarde. lamentamos las molestias'
export const SERVICE_IN_PROGRESS = 'Tienes un servicio en progreso para reportar una queja comunicate al ...'
export const SERVICE_ASSIGNED = 'El Móvil 🚘  834 🚗  en un momento se comunica contigo. Recuerda verificar tus pertenencias antes de bajarte del vehículo\n'
export const SERVICE_COMPLETED = 'Esperamos hayas disfrutado tu viaje, si tienes alguna sugerencia por favor escribe al ******\n\n' +
  'GRACIAS POR CONFIAR EN RED BLANCA POPAYÁN❣️✨'
