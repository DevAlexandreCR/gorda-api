import Session from '../../Models/Session'
import Service from '../../Models/Service'
import { Store } from '../store/Store'
import ServiceRepository from '../../Repositories/ServiceRepository'
import Container from '../../Container/Container'
import ChatIdHelper from '../../Helpers/ChatIdHelper'
import * as Sentry from '@sentry/node'
import * as Messages from './Messages'
import { MessagesEnum } from './MessagesEnum'
import { PlaceInterface } from '../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../Interfaces/ClientInterface'
import { ChatBotMessage } from '../../Types/ChatBotMessage'

export interface BookServiceParams {
  place: PlaceInterface
  client: ClientInterface
  comment?: string | null
  // The caller's outbound-send path (turn gate + persistence, e.g.
  // ResponseContract.sendMessage/TurnSupport): only used on the setService
  // failure branch, to report ERROR_CREATING_SERVICE exactly as today.
  sendMessage: (message: ChatBotMessage) => Promise<void>
}

/**
 * Shared service-booking flow (design D3/D7, task 2.6): computes the
 * client's completed-services count, creates the service with the pickup
 * place/comment/client name+phone, gates the write behind the turn's
 * assertTurnStillValid check, and moves the session to REQUESTING_SERVICE.
 * Extracted from ResponseContract.createService so the legacy strategies
 * (until task 3.4 deletes them), the agent executor (task 2.7) and the
 * location assistant (task 3.3) share one implementation.
 */
export async function bookService(session: Session, params: BookServiceParams): Promise<string> {
  const { place, client, comment = null, sendMessage } = params

  const service = new Service()
  service.wp_client_id = session.wp_client_id
  service.client_id = ChatIdHelper.toCanonicalClientId(session.chat_id)
  const cityId = place.cityId || 'popayan'
  service.start_loc = {
    ...place,
    city: cityId,
    country: Store.getInstance().findCountryByCity(cityId),
  }
  service.phone = client.phone
  service.name = client.name
  if (comment) service.comment = comment

  const canonicalClientId = service.client_id
  try {
    service.client_completed_services_count = await Container.getServiceHistoryRepository().count({
      clientId: canonicalClientId,
      status: 'terminated',
      excludeDriverOrigin: true,
    })
  } catch (error) {
    service.client_completed_services_count = 0
    Sentry.captureException(error)
  }

  // Turn gate (design D3): the only gate point protecting the
  // service-booking write itself.
  await session.assertTurnStillValid()

  const dbService = await ServiceRepository.create(service)
  session.service_id = dbService.id
  if (session.service_id) {
    await session
      .setService(session.service_id)
      .then(async () => {
        await session.setStatus(Session.STATUS_REQUESTING_SERVICE)
      })
      .catch(async (e: Error) => {
        console.error('error creating service', session.chat_id, e.message, e.stack)
        await sendMessage(Messages.getSingleMessage(MessagesEnum.ERROR_CREATING_SERVICE))
        await session.setStatus(Session.STATUS_BOOKING)
      })
  }

  return Promise.resolve(service.id)
}
