import cron from 'node-cron'
import {updateSessionAbandoned} from './CloseSessionsJob'

class Schedule {
  execute(): void {
    cron.schedule('*/5 * * * *', updateSessionAbandoned)
  }
}

export default new Schedule()
