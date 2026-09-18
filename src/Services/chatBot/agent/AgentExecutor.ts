import Session from '../../../Models/Session'
import Container from '../../../Container/Container'
import MessageHelper from '../../../Helpers/MessageHelper'
import * as Messages from '../Messages'
import { MessagesEnum } from '../MessagesEnum'
import { Store } from '../../store/Store'
import { WpMessage } from '../../../Types/WpMessage'
import { WpLocation } from '../../../Types/WpLocation'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { SessionStatePlaceCandidate } from '../../../Types/SessionState'
import { bookService } from '../ServiceBooking'
import { cancelService, insistService, SendMessage } from '../deterministic/DeterministicHandlers'
import { AgentAction, AgentActionType } from './AgentPrompt'

// Action vocabulary and deterministic validation / Service creation turn sends the
// catalog confirmation only / GPS location fixes the place without search / Support
// escalation (chatbot-agent-conversation spec) — design D3, task 2.7. AgentValidator
// (task 2.5) has already accepted every action passed in `acceptedActions`: this module
// only applies them, in order, through the existing repositories/helpers.

export interface AgentExecutorContext {
  // Turn-gated outbound send injected by AgentTurn (task 2.8) — the same function
  // ResponseContract.sendMessage/TurnSupport wraps, reused unchanged here (design D3:
  // "All sends go through the existing sendMessage path").
  sendMessage: SendMessage
  // The current merged unprocessed message for this turn — source of the GPS
  // coordinates for set_place_from_location and, via session.chat, the WhatsApp
  // contact/pushname for set_client_name.
  currentMessage: WpMessage
  // The pool of place candidates AgentValidator accepted `set_place` ids against this
  // turn (ToolCallLedger.candidates unioned with session.state.pending_candidates from
  // earlier turns). PlaceRepository.findById(id) is still the canonical source of the
  // full PlaceInterface (lat/lng/cityId) ServiceBooking needs; this pool is consulted
  // only as a name fallback for the error log on the defensive, should-be-unreachable
  // path where that load comes back empty for an id the validator already accepted.
  placeCandidates: SessionStatePlaceCandidate[]
}

export type ExecutionHaltReason = 'non_covered_area'

export interface ExecutionResult {
  // AgentActionType values, in the order actually applied (stops early on `halted`).
  executed: AgentActionType[]
  // Set when a validated `create_service` executed this turn (spec: "Service creation
  // turn sends the catalog confirmation only") — AgentTurn must discard the agent's
  // reply text and let the SERVICE_CREATED catalog message speak for the turn instead.
  suppressReply: boolean
  // Set when a `set_place_from_location` pin fell outside the covered area: the
  // executor already sent NON_COVERED_AREA and moved the session to COMPLETED, and
  // stopped applying any further action in the list.
  halted?: ExecutionHaltReason
  // Set when `escalate_support` executed — AgentTurn still sends the agent's reply for
  // this turn (spec: "Support escalation and failure fallback": "the backend SHALL
  // send the agent's reply, move the session to SUPPORT").
  escalated?: boolean
}

async function applySetClientName(session: Session, name: string): Promise<void> {
  // Same contact shape AskingForName/Created build today: the WhatsApp contact
  // fetched off the chat, pushname overridden with the agent-provided (normalized)
  // name, then cached through Store.createClient so any later action in this same
  // turn (e.g. create_service) sees it via Store.findClientById.
  const contact = await session.chat.getContact()
  contact.pushname = MessageHelper.normalizeName(name)
  await Store.getInstance().createClient(contact)
}

async function applySetPlace(
  session: Session,
  placeId: string,
  ctx: AgentExecutorContext
): Promise<void> {
  let place: PlaceInterface | null = null
  try {
    place = await Container.getPlaceRepository().findById(placeId)
  } catch (error) {
    console.error(
      'AgentExecutor: failed to load place by id',
      session.id,
      placeId,
      (error as Error).message
    )
  }

  if (!place) {
    // Should be unreachable: AgentValidator only accepts ids returned by search_place
    // this turn or stored as a pending candidate. Degrade defensively (skip the
    // action) rather than throwing and losing the rest of the turn's actions.
    const fallbackName = ctx.placeCandidates.find((candidate) => candidate.id === placeId)?.name
    console.error('AgentExecutor: set_place id not found in repository', session.id, placeId, {
      fallbackName,
    })
    return
  }

  await session.setPlace(place)
  await session.setState({ pending_candidates: [] })
}

/**
 * Coverage check duplicated minimally from ResponseContract.findContainingPolygon /
 * getPlaceFromLocation (design D3: "extract or duplicate minimally"): single-city
 * deployment today, hardcoded to 'popayan' (the real polygon check is commented out
 * there too). Kept local instead of imported so this module carries no dependency on
 * ResponseContract, which task 3.4 deletes.
 */
function resolveCoverageCity() {
  return Store.getInstance().findCityById('popayan') ?? null
}

async function applySetPlaceFromLocation(
  session: Session,
  reference: string,
  ctx: AgentExecutorContext
): Promise<{ halted: boolean }> {
  // GPS location fixes the place without search: the pin is either the current
  // message's location, or — when the customer's reference-name message arrives on a
  // later, text-only turn — the pin stored by storePendingPin on the turn the location
  // itself arrived on. AgentValidator already requires one of the two to be present.
  const pin = ctx.currentMessage.location
    ? { lat: ctx.currentMessage.location.lat, lng: ctx.currentMessage.location.lng }
    : session.state.pending_pin

  if (!pin) {
    console.error(
      'AgentExecutor: set_place_from_location with no location this turn and no pending pin',
      session.id
    )
    return { halted: false }
  }

  const city = resolveCoverageCity()
  if (!city) {
    await ctx.sendMessage(Messages.getSingleMessage(MessagesEnum.NON_COVERED_AREA))
    await session.setStatus(Session.STATUS_COMPLETED)
    return { halted: true }
  }

  const place: PlaceInterface = {
    id: '',
    name: reference,
    lat: pin.lat,
    lng: pin.lng,
    location: null,
    cityId: city.id,
  }

  await session.setPlace(place)
  await session.setState({ pending_pin: null })
  return { halted: false }
}

async function applyCreateService(session: Session, ctx: AgentExecutorContext): Promise<void> {
  const place = session.place
  const client = Store.getInstance().findClientById(session.chat_id)

  if (!place || !client) {
    // Should be unreachable: AgentValidator's create_service rule requires
    // clientExists/placeConfirmed. Degrade defensively rather than throwing.
    console.error('AgentExecutor: create_service missing place or client', session.id, {
      hasPlace: !!place,
      hasClient: !!client,
    })
    return
  }

  await bookService(session, {
    place,
    client,
    comment: session.state.comment,
    sendMessage: ctx.sendMessage,
  })
}

/**
 * Stores the current turn's GPS pin as pending (chatbot-agent-conversation spec, "GPS
 * location fixes the place without search", "Pin without a name" scenario): called by
 * AgentTurn (task 2.8) when the merged turn carries a location but the agent's output
 * did not include set_place_from_location (e.g. it asked for a reference name
 * instead). The next text-only turn's set_place_from_location(reference) then resolves
 * against this stored pin.
 */
export async function storePendingPin(session: Session, location: WpLocation): Promise<void> {
  await session.setState({ pending_pin: { lat: location.lat, lng: location.lng } })
}

/**
 * Applies AgentValidator's accepted actions, in order, through the existing
 * repositories and deterministic helpers (design D3, task 2.7). Stops early only when
 * an action halts the turn outright (a non-covered pin, which already sent the
 * customer-facing message and ended the session) — every other action always runs
 * to completion even if a previous one degraded defensively.
 */
export async function executeAgentActions(
  session: Session,
  acceptedActions: AgentAction[],
  ctx: AgentExecutorContext
): Promise<ExecutionResult> {
  const executed: AgentActionType[] = []
  let suppressReply = false
  let escalated = false

  for (const action of acceptedActions) {
    switch (action.type) {
      case 'set_client_name':
        await applySetClientName(session, action.name)
        executed.push(action.type)
        break

      case 'set_place':
        await applySetPlace(session, action.placeId, ctx)
        executed.push(action.type)
        break

      case 'set_place_from_location': {
        const { halted } = await applySetPlaceFromLocation(session, action.reference, ctx)
        executed.push(action.type)
        if (halted) {
          return { executed, suppressReply, halted: 'non_covered_area' }
        }
        break
      }

      case 'set_comment':
        await session.setState({ comment: action.text })
        executed.push(action.type)
        break

      case 'create_service':
        await applyCreateService(session, ctx)
        executed.push(action.type)
        suppressReply = true
        break

      case 'cancel_service':
        await cancelService(session)
        executed.push(action.type)
        break

      case 'insist_service':
        await insistService(session, ctx.sendMessage)
        executed.push(action.type)
        break

      case 'escalate_support':
        await session.setStatus(Session.STATUS_SUPPORT)
        executed.push(action.type)
        escalated = true
        break
    }
  }

  return {
    executed,
    suppressReply,
    ...(escalated ? { escalated: true } : {}),
  }
}
