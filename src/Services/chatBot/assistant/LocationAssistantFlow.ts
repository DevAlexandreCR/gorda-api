import Session from '../../../Models/Session'
import MessageHelper from '../../../Helpers/MessageHelper'
import { Store } from '../../store/Store'
import * as Messages from '../Messages'
import { MessagesEnum } from '../MessagesEnum'
import { bookService } from '../ServiceBooking'
import { sendGatedMessage } from '../TurnSupport'
import {
  handleInTripMessage,
  handleRequestingServiceMessage,
  isCancelMessage,
} from '../deterministic/DeterministicHandlers'
import { WpMessage } from '../../../Types/WpMessage'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'

// Deterministic, no-AI booking flow for `assistant` lines (design D6, spec
// chatbot-assistant-location-flow): reimplements the pieces of the legacy
// Created/AskingForName/AskingForPlace/AskingForComment chain that a
// location-only line actually exercises, on the new BOOKING/state.awaiting
// model instead of per-step statuses. Zero model calls: this file has no
// dependency on the agent runtime module (context builder, OpenAI client,
// tools, validator, executor) at all.
//
// Session creation on the first location message for an `assistant` line
// with no active session is the dispatcher's job (task 3.1, spec "Location
// starts the flow") — this module only runs turns for a session that already
// exists.

function send(session: Session, message: ChatBotMessage): Promise<void> {
  return sendGatedMessage(session, message)
}

/**
 * Coverage check duplicated minimally from ResponseContract.findContainingPolygon
 * (design D3 precedent, also duplicated in AgentExecutor.resolveCoverageCity):
 * single-city deployment today, hardcoded to 'popayan'. Kept local so this module
 * carries no dependency on ResponseContract, which task 3.4 deletes.
 */
function resolveCoverageCity() {
  return Store.getInstance().findCityById('popayan') ?? null
}

async function createClientWithName(session: Session, name: string): Promise<void> {
  const contact = await session.chat.getContact()
  contact.pushname = MessageHelper.normalizeName(name)
  await Store.getInstance().createClient(contact)
}

/**
 * Resumes the booking from whatever is currently known on the session: asks
 * for whatever is still missing (client name, then place reference), or —
 * once both are resolved — sends the requesting-service message and waits
 * for the comment. Re-evaluating from session state (rather than tracking
 * what was asked) lets a single location message that already carries both a
 * profile name and a named pin fall straight through to the comment step.
 */
async function advanceBooking(session: Session): Promise<void> {
  if (!Store.getInstance().findClientById(session.chat_id)) {
    const contact = await session.chat.getContact()
    const pushname = (contact.pushname ?? '').trim()
    if (!pushname) {
      await session.setState({ awaiting: 'name' })
      await send(session, Messages.getSingleMessage(MessagesEnum.ASK_FOR_NAME))
      return
    }
    await createClientWithName(session, pushname)
  }

  if (!session.place) {
    await session.setState({ awaiting: 'reference' })
    await send(session, Messages.getSingleMessage(MessagesEnum.ASK_FOR_LOCATION_NAME))
    return
  }

  await session.setState({ awaiting: 'comment' })
  await send(session, Messages.requestingService(session.place.name))
}

async function handleLocationMessage(session: Session, message: WpMessage): Promise<void> {
  const location = message.location
  if (!location) return

  const city = resolveCoverageCity()
  if (!city) {
    await send(session, Messages.getSingleMessage(MessagesEnum.NON_COVERED_AREA))
    await session.setStatus(Session.STATUS_COMPLETED)
    return
  }

  await session.setState({ pending_pin: { lat: location.lat, lng: location.lng } })

  if (location.name && location.name !== MessageHelper.LOCATION_NO_NAME) {
    const place: PlaceInterface = {
      id: '',
      name: location.name,
      lat: location.lat,
      lng: location.lng,
      location: null,
      cityId: city.id,
    }
    await session.setPlace(place)
    await session.setState({ pending_pin: null })
  }

  await advanceBooking(session)
}

async function handleAwaitingName(session: Session, message: WpMessage): Promise<void> {
  await createClientWithName(session, message.msg)
  await advanceBooking(session)
}

async function handleAwaitingReference(session: Session, message: WpMessage): Promise<void> {
  const reference = (message.msg ?? '').trim()
  if (reference.length < 4) {
    await send(session, Messages.getSingleMessage(MessagesEnum.NO_LOCATION_NAME_FOUND))
    return
  }

  const pin = session.state.pending_pin
  if (!pin) {
    // Defensive: unreachable — awaiting 'reference' is only set right after
    // storing pending_pin, and session.place stays null until this resolves.
    return
  }

  const city = resolveCoverageCity()
  const place: PlaceInterface = {
    id: '',
    name: reference,
    lat: pin.lat,
    lng: pin.lng,
    location: null,
    cityId: city?.id ?? '',
  }
  await session.setPlace(place)
  await session.setState({ pending_pin: null })
  await advanceBooking(session)
}

async function handleAwaitingComment(session: Session, message: WpMessage): Promise<void> {
  if (isCancelMessage(message)) {
    await session.setStatus(Session.STATUS_COMPLETED)
    return
  }

  const place = session.place
  const client = Store.getInstance().findClientById(session.chat_id)
  if (!place || !client) {
    // Defensive: unreachable — awaiting 'comment' is only set once both are resolved.
    return
  }

  const text = (message.msg ?? '').trim()
  const comment = text.length > 2 ? text : null

  await bookService(session, {
    place,
    client,
    comment,
    sendMessage: (m) => send(session, m),
  })
}

async function handleBooking(session: Session, message: WpMessage): Promise<void> {
  if (message.type === MessageTypes.LOCATION && message.location) {
    await handleLocationMessage(session, message)
    return
  }

  switch (session.state.awaiting) {
    case 'name':
      await handleAwaitingName(session, message)
      return
    case 'reference':
      await handleAwaitingReference(session, message)
      return
    case 'comment':
      await handleAwaitingComment(session, message)
      return
    default:
      // Defensive (spec: "should not happen for assistant lines since sessions
      // start on a location"): nothing pending, no reply.
      return
  }
}

/**
 * Runs one deterministic turn of the assistant-line booking flow (design D5/D6).
 * The dispatcher (task 3.1) calls this for every `assistant`-line turn while the
 * session is in BOOKING, REQUESTING_SERVICE or SERVICE_IN_PROGRESS; SUPPORT/
 * COMPLETED sessions are no-ops handled upstream, before dispatch reaches here.
 */
export async function runLocationAssistantTurn(
  session: Session,
  message: WpMessage
): Promise<void> {
  switch (session.status) {
    case Session.STATUS_BOOKING:
      await handleBooking(session, message)
      return
    case Session.STATUS_REQUESTING_SERVICE:
      await handleRequestingServiceMessage(session, message, (m) => send(session, m))
      return
    case Session.STATUS_SERVICE_IN_PROGRESS:
      await handleInTripMessage(session, message)
      return
    default:
      return
  }
}
