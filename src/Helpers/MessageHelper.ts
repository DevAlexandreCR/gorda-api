export default class MessageHelper {
  static USER_LOCATION = 'Ubicación del usuario'
  static LOCATION_NO_NAME = 'location-no-name'
  static CANCEL = 'cancelar'
  static KEYS = ['servicio', 'movil']

  public static normalize(str: string) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toLowerCase()
      .trim()
  }
  public static isPlaceName(str: string): boolean {
    const nameRegex = /^[a-zA-Z]+(([',. -][a-zA-Z ])?[a-zA-Z]*)*$/
    const locationRegex = /^[0-9a-zA-Z\s,'-]*$/
    return nameRegex.test(str) || locationRegex.test(str)
  }

  public static hasKey(message: string): boolean {
    return message.includes(this.KEYS[0]) || message.includes(this.KEYS[1])
  }

  public static isCancel(message: string): boolean {
    return this.normalize(message).includes(this.CANCEL)
  }

  public static getPlace(message: string): string {
    message = MessageHelper.normalize(message)
    const keyRemoved = message
      .replace(/(.?)+(servicio|movil)+([para, el, la, los, el, las, a, en]*)/, '')
      .trim()
    const place = keyRemoved
      .replace(
        new RegExp(
          '(barrio|centro comercial|cc |hospital|urbanizacion' +
            'condominio|unidad|conjunto|conjunto residencial|restaurante|colegio|)'
        ),
        ''
      )
      .trim()

    return place
      .replace(new RegExp('(por favor|gracias|si es tan amable|muchas gracias|porfa)'), '')
      .trim()
  }

  public static getServiceIdFromCancel(message: string): string {
    const idReg = message.match(/(?<=id=).*/)

    return idReg ? idReg[0] : ''
  }

  public static getPlaceFromAgreement(message: string): string {
    message = MessageHelper.normalize(message)
    const placeReg = message.match(/(?<=convenio).*/)

    return placeReg ? placeReg[0] : ''
  }

  public static getCommentFromAgreement(message: string): string {
    message = MessageHelper.normalize(message)
    const commentReg = message.match(/(?<=movil|servicio )(.*)(?= convenio )/)
    let comment = 'convenio '

    return commentReg ? (comment += commentReg[0]) : comment
  }

  static normalizeName(name: string): string {
    const parts = name.split(' ')
    let normalizedName = ''
    parts.forEach((part) => {
      normalizedName += part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() + ' '
    })

    return normalizedName.trim()
  }

  static truncatePlate(plate: string): string {
    return plate.replace(/^.{3}/g, '')
  }

  // Courtesy keywords to ignore (normalized)
  private static COURTESY_TERMS: string[] = [
    'ok',
    'okay',
    'oki',
    'okey',
    'dale',
    'listo',
    'vale',
    'gracias',
    'gracia',
    'grasias',
    'grasi',
    'porfa',
    'por favor',
    'bien',
    'ta bien',
    'esta bien',
    'todo bien',
    'bueno',
    'bueni',
    'perfecto',
    'excelente',
    'genial',
    'sip',
    'si',
    'claro',
    'thanks',
    'thank you',
  ].map((x) => MessageHelper.normalize(x))

  /**
   * Compute Levenshtein distance between two strings
   */
  private static levenshtein(a: string, b: string): number {
    const an = a.length
    const bn = b.length
    if (an === 0) return bn
    if (bn === 0) return an

    const matrix: number[][] = Array.from({ length: an + 1 }, () => new Array(bn + 1).fill(0))
    for (let i = 0; i <= an; i++) matrix[i][0] = i
    for (let j = 0; j <= bn; j++) matrix[0][j] = j

    for (let i = 1; i <= an; i++) {
      const ca = a.charCodeAt(i - 1)
      for (let j = 1; j <= bn; j++) {
        const cb = b.charCodeAt(j - 1)
        const cost = ca === cb ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        )
      }
    }

    return matrix[an][bn]
  }

  /**
   * Similarity ratio between 0 and 1 based on Levenshtein distance.
   */
  private static similarity(a: string, b: string): number {
    if (!a && !b) return 1
    if (!a || !b) return 0
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const dist = this.levenshtein(a, b)
    return 1 - dist / maxLen
  }

  /**
   * Check if message is likely a courtesy/ack message.
   * Uses normalization and fuzzy matching with a default threshold.
   */
  static isCourtesyMessage(message: string, threshold = 0.74): boolean {
    if (!message) return false
    const normalized = this.normalize(message)
    if (!normalized) return false

    // Short messages are more likely to be courtesy; try whole-string first
    for (const term of this.COURTESY_TERMS) {
      if (normalized === term) return true
      if (this.similarity(normalized, term) >= threshold) return true
    }

    // Check word-by-word for messages like "ok gracias" or "dale listo"
    const parts = normalized.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return false

    // If every token resembles a courtesy term, consider it courtesy
    const allCourtesy = parts.every((token) =>
      this.COURTESY_TERMS.some((term) => {
        if (token === term) return true
        return this.similarity(token, term) >= threshold
      })
    )
    if (allCourtesy) return true

    // Also handle two-word courtesy phrases inside the message (e.g., "esta bien")
    if (parts.length >= 2) {
      for (let i = 0; i < parts.length - 1; i++) {
        const bigram = `${parts[i]} ${parts[i + 1]}`
        if (
          this.COURTESY_TERMS.some(
            (term) => bigram === term || this.similarity(bigram, term) >= threshold
          )
        )
          return true
      }
    }

    return false
  }
}
