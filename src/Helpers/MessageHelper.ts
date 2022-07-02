export default class MessageHelper {
  public static normalice(str: String) {
    return str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toLowerCase()
  }
}