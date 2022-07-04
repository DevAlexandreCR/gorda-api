export default class MessageHelper {
  static NEIGHBOR = 'barrio'
  static CC = 'cc '
  static MOL = 'centro comercial'
  static URBANIZATION = 'urbanizacion'
  static RESIDENTIAL = 'conjunto'
  static RESIDENTIAL_GATED = 'conjunto residencial'
  static UNIT = 'unidad'
  static CONDOMINIUM = 'condominio'
  static USER_LOCATION = 'Ubicación del usuario'
  static CANCEL = 'cancelar'
  public static normalice(str: string) {
    return str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toLowerCase().trim()
  }
  
  public static hasPlace(message: string): string|false {
    message = MessageHelper.normalice(message)
    let findPlace = ''
    switch (true) {
      case message.includes(MessageHelper.NEIGHBOR):
        findPlace = MessageHelper.getPlace(MessageHelper.NEIGHBOR, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.CC):
        findPlace = MessageHelper.getPlace(MessageHelper.CC, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.MOL):
        findPlace = MessageHelper.getPlace(MessageHelper.MOL, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.URBANIZATION):
        findPlace = MessageHelper.getPlace(MessageHelper.URBANIZATION, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.RESIDENTIAL_GATED):
        findPlace = MessageHelper.getPlace(MessageHelper.RESIDENTIAL_GATED, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.RESIDENTIAL):
        findPlace = MessageHelper.getPlace(MessageHelper.RESIDENTIAL, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.UNIT):
        findPlace = MessageHelper.getPlace(MessageHelper.UNIT, message)
        return MessageHelper.normalice(findPlace)
      case message.includes(MessageHelper.CONDOMINIUM):
        findPlace = MessageHelper.getPlace(MessageHelper.CONDOMINIUM, message)
        return MessageHelper.normalice(findPlace)
      default: return false
    }
  }
  
  static getPlace(find: string, message: string): string {
    return message.substring(find.length + 1)
  }
}