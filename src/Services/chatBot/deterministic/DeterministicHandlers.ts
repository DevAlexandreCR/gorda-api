import Session from '../../../Models/Session'
import Service from '../../../Models/Service'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import MessageHelper from '../../../Helpers/MessageHelper'
import * as Messages from '../Messages'
import { MessagesEnum } from '../MessagesEnum'
import { WpMessage } from '../../../Types/WpMessage'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'
import { Store } from '../../store/Store'
import dayjs from 'dayjs'
import Database from '../../firebase/Database'
import { interactiveReplyId } from '../../whatsapp/interactive/interactiveReplyId'

// Same injection pattern as ServiceBooking.bookService (task 2.6): callers
// pass their own turn-gated outbound send path, so this module stays
// decoupled from ResponseContract/TurnSupport and is reusable by the
// dispatcher (task 3.1) and the agent executor (task 2.7).
export type SendMessage = (message: ChatBotMessage) => Promise<void>

async function loadService(session: Session): Promise<Service | null> {
  if (!session.service_id) return null
  const record = await ServiceRepository.findServiceById(session.service_id)
  const service = new Service()
  Object.assign(service, record)
  return service
}

function interactiveButtonId(message: WpMessage): string {
  if (message.type === MessageTypes.INTERACTIVE) {
    const id = interactiveReplyId(message.interactiveReply)
    if (id) {
      return id.toUpperCase()
    }
  }
  return ''
}

export function isCancelMessage(message: WpMessage): boolean {
  return (
    interactiveButtonId(message) === 'CANCEL' ||
    message.msg.toLowerCase().includes(MessageHelper.CANCEL)
  )
}

// Button-only, unlike isCancelMessage above: the dispatcher (task 3.1) needs to
// tell the CANCEL button apart from the "cancelar" keyword on chatBot lines,
// where free text always goes to the agent (its own cancel_service action)
// while only the button short-circuits deterministically (design D5/spec
// "Silence rules by status and line settings").
export function isCancelButton(message: WpMessage): boolean {
  return interactiveButtonId(message) === 'CANCEL'
}

export function isInsistMessage(message: WpMessage): boolean {
  return interactiveButtonId(message) === 'INSIST'
}

/**
 * Cancels the session's active service and completes the session (ported
 * from `RequestingService`/`ServiceInProgress`). Reused by
 * `handleRequestingServiceMessage`, `handleInTripMessage`, the chatBot-line
 * CANCEL button short-circuit (task 3.1) and the agent executor's
 * `cancel_service` action (task 2.7). Sends nothing itself: the CANCELED
 * catalog message is delivered by `WhatsAppClient.serviceChanged`'s RTDB
 * listener once the status write lands, same event-driven role as today
 * (design D7).
 */
export async function cancelService(session: Session): Promise<void> {
  const service = await loadService(session)
  if (!service) return
  await service.cancel()
  await session.setStatus(Session.STATUS_COMPLETED)
}

/**
 * Re-queues the active service (bumps `created_at`, clears the pending
 * `ASK_FOR_CANCEL` timeout) and sends the `INSISTING` catalog message
 * directly (ported from `RequestingService.restartService`). Reused by
 * `handleRequestingServiceMessage`, the chatBot-line INSIST button
 * short-circuit and the agent executor's `insist_service` action.
 */
export async function insistService(session: Session, sendMessage: SendMessage): Promise<void> {
  const service = await loadService(session)
  if (service?.id) {
    const newCreatedAt = dayjs().unix()
    service.created_at = newCreatedAt
    await Database.dbServices().child(service.id).update({ created_at: newCreatedAt })

    const whatsappClient = Store.getInstance().getWhatsAppClient(session.wp_client_id)
    if (whatsappClient) {
      whatsappClient.cancelTimeout(service.id, session.chat_id)
    }
  }
  await sendMessage(Messages.getSingleMessage(MessagesEnum.INSISTING))
}

/**
 * Sends the ask-for-cancel-while-searching catalog message. Exposed as its
 * own function (not folded into `handleRequestingServiceMessage`) because
 * only `assistant` lines send it — on `chatBot` lines the agent handles free
 * text in `REQUESTING_SERVICE` (design D5/D7), so the dispatcher must never
 * call this for a `chatBot` line.
 */
export async function askForCancelWhileFindDriver(sendMessage: SendMessage): Promise<void> {
  await sendMessage(Messages.getSingleMessage(MessagesEnum.ASK_FOR_CANCEL_WHILE_FIND_DRIVER))
}

/**
 * Full `REQUESTING_SERVICE` deterministic turn for `assistant` lines (ported
 * from the deleted `RequestingService` strategy, design D5/D6): the
 * "cancelar" keyword or the `CANCEL` button cancels; the `INSIST` button
 * re-queues; anything else gets the ask-for-cancel-while-searching message.
 * `chatBot` lines never call this: the dispatcher (task 3.1) short-circuits
 * only the `CANCEL`/`INSIST` button replies there via `cancelService`/
 * `insistService` directly and lets the agent handle every other message.
 */
export async function handleRequestingServiceMessage(
  session: Session,
  message: WpMessage,
  sendMessage: SendMessage
): Promise<void> {
  if (isCancelMessage(message)) {
    await cancelService(session)
  } else if (isInsistMessage(message)) {
    await insistService(session, sendMessage)
  } else {
    await askForCancelWhileFindDriver(sendMessage)
  }
}

/**
 * `SERVICE_IN_PROGRESS` deterministic turn (ported from the deleted
 * `ServiceInProgress` strategy): cancels on "cancelar"/`CANCEL`, stays silent
 * otherwise. Used for `assistant` lines always, and for `chatBot` lines with
 * `agentInTrip` disabled (design D5's `InTripCancelOnly`).
 */
export async function handleInTripMessage(session: Session, message: WpMessage): Promise<void> {
  if (isCancelMessage(message)) {
    await cancelService(session)
  }
}
