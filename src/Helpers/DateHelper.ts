import dayjs from 'dayjs'

class DateHelper {
  dateString(): string {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
  }

  unix(): number {
    return dayjs().unix()
  }
}

export default new DateHelper()
