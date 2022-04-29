export const requestingService = (neighborhood: string): string => {
  return  'Barrio *' + neighborhood + REQUESTING_SERVICE
}
export const REQUESTING_SERVICE = '* Con mucho gusto en un momento te confirmo😊 (por favor *no responder este mensaje* porque retrasaría la asignación de  tu servicio confirmamos en orden de llegada '
export const ASK_FOR_NEIGHBORHOOD = 'Hola 🙋🏻‍♀️ te has comunicado con *RED BLANCA POPAYÁN ✨ Confirma por favor BARRIO* donde te encuentras para asignarte un vehículo en el menor tiempo posible 💞 ejemplo: \n barrio -Centro-'
export const NON_NEIGHBORHOOD_FOUND = 'No logramos identificar el barrio por favor vuelve a escribirlo, no olvides encerrarlo entre - ejemplo *barrio -Centro-*'
export const ASK_FOR_DRIVER = 'El servicio se creó correctamente, en cuanto un conductor se reporte te estaremos informando \n por favor espera unos segundos...'
