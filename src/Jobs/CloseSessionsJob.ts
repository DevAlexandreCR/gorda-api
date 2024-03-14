import SessionRepository from '../Repositories/SessionRepository'
import {SessionInterface} from '../Interfaces/SessionInterface'
import dayjs from 'dayjs'
import Session from '../Models/Session'
import * as Sentry from '@sentry/node'

function isSessionAbandoned(session: SessionInterface): boolean {
  const sessionDate = session.created_at
  const now = dayjs().unix() * 1000
  const rate = now - sessionDate

  return rate > 1800000
}

export async function updateSessionAbandoned(): Promise<void> {
  const sessions = await SessionRepository.getActiveSessions()
  const sessionsAbandoned = Array<SessionInterface>()
  console.log('updating abandoned sessions...')
  sessions.forEach(session => {
    if (isSessionAbandoned(session)) {
      session.status = Session.STATUS_COMPLETED
      sessionsAbandoned.push(session)
    }
  })
  SessionRepository.closeAbandoned(sessionsAbandoned).catch(e => {
		Sentry.captureException(e)
  })
}
