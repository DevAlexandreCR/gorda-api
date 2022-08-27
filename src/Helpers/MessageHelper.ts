export default class MessageHelper {
  static USER_LOCATION = 'Ubicación del usuario'
  static CANCEL = 'cancelar'
  static KEY = 'servicio'

  public static normalize(str: string) {
    return str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toLowerCase().trim()
  }

  public static hasKey(message: string): boolean {
    return message.includes(this.KEY)
  }

  public static getPlace(message: string): string {
    message = MessageHelper.normalize(message)
    const keyRemoved = message.replace(
        /(.?)+(servicio)+([para, el, la, los, el, las, a, en]*)/,
        '').trim()
    const place =  keyRemoved.replace(new RegExp('(barrio|centro comercial|cc |hospital|urbanizacion' +
        'condominio|unidad|conjunto|conjunto residencial|restaurante|colegio|)'), '').trim()

    return place.replace(new RegExp('(por favor|gracias|si es tan amable|muchas gracias|porfa)'), '').trim()
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
    return plate.replace(/^.{3}/g, '***')
  }
}