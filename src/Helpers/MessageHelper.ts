export default class MessageHelper {
  static USER_LOCATION = 'Ubicación del usuario'
  static LOCATION_NO_NAME = 'location-no-name'
  static CANCEL = 'cancelar'
  static KEYS = ['servicio', 'movil']

  public static normalize(str: string) {
    return str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toLowerCase().trim()
  }

  public static hasKey(message: string): boolean {
    return message.includes(this.KEYS[0]) || message.includes(this.KEYS[1])
  }

  public static isCancel(message: string): boolean {
    return this.normalize(message).includes(this.CANCEL)
  }

  public static getPlace(message: string): string {
    message = MessageHelper.normalize(message)
    const keyRemoved = message.replace(
        /(.?)+(servicio|movil)+([para, el, la, los, el, las, a, en]*)/,
        '').trim()
    const place =  keyRemoved.replace(new RegExp('(barrio|centro comercial|cc |hospital|urbanizacion' +
        'condominio|unidad|conjunto|conjunto residencial|restaurante|colegio|)'), '').trim()

    return place.replace(new RegExp('(por favor|gracias|si es tan amable|muchas gracias|porfa)'), '').trim()
  }

  public static getServiceIdFromCancel(message: string): string {
    const idReg = message.match(/(?<=id=).*/)

    return idReg ? idReg[0] : ''
  }

  public static getPlaceFromAgreement(message: string): string {
    message = MessageHelper.normalize(message)
    const placeReg = message.match(/(?<=convenio).*/)

    return placeReg? placeReg[0] : ''
  }

  public static getCommentFromAgreement(message: string): string {
    message = MessageHelper.normalize(message)
    const commentReg = message.match(/(?<=movil|servicio )(.*)(?= convenio )/)
    let comment = 'convenio '

    return commentReg? comment += commentReg[0] : comment
  }

  static normalizeName(name: string): string {
    const parts = name.split(' ')
    let normalizedName = ''
    parts.forEach(part => {
      normalizedName += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() + ' '
    })

    return normalizedName.trim()
  }

  static truncatePlate(plate: string): string {
    return plate.replace(/^.{3}/g, '')
  }
}