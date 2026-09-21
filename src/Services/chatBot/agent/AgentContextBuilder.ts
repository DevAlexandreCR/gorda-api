import config from '../../../../config'
import Session from '../../../Models/Session'
import Container from '../../../Container/Container'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import ChatIdHelper from '../../../Helpers/ChatIdHelper'
import MessageHelper from '../../../Helpers/MessageHelper'
import DateHelper from '../../../Helpers/DateHelper'
import { Locale } from '../../../Helpers/Locale'
import { Store } from '../../store/Store'
import { resolveDriverCurrentVehicle } from '../../drivers/DriverVehicleResolver'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { WpMessage } from '../../../Types/WpMessage'
import { ServiceInterface } from '../../../Interfaces/ServiceInterface'
import { ResponsesInputItem } from './OpenAIResponsesClient'

// Agent context contract (chatbot-agent-conversation spec, "Agent context
// contract") — field names mirror agent/prompts/agent.md exactly (task 2.2's
// documented contract). The developer JSON item never carries the raw
// conversation history: that travels as separate user/assistant input items
// (design D2), so it is returned alongside the context rather than inside it.

export type AgentSessionStatus = 'BOOKING' | 'REQUESTING_SERVICE' | 'SERVICE_IN_PROGRESS'

export interface AgentContextClient {
  name: string | null
  completed_services: number
  recent_places: string[]
}

export interface AgentContextSessionCandidate {
  id: string
  name: string
}

export interface AgentContextSession {
  status: AgentSessionStatus
  place: string | null
  comment: string | null
  pending_candidates: AgentContextSessionCandidate[]
  pending_pin_awaiting_reference: boolean
  is_first_reply: boolean
}

export interface AgentContextService {
  minutes_since_created: number
  driver_assigned: boolean
  vehicle_plate: string | null
  vehicle_color: string | null
  driver_arrived: boolean
}

export interface AgentContextLine {
  company_name: string
  pqr_number: string
  city: string
}

export interface AgentContextCurrentMessageLocation {
  lat: number
  lng: number
  name: string | null
}

export interface AgentContextCurrentMessage {
  text: string
  location: AgentContextCurrentMessageLocation | null
  interactive_reply_id: string | null
}

export interface AgentActionRejection {
  action: string
  reason: string
}

export type AgentSystemEvent = {
  type: 'action_rejected'
  rejections: AgentActionRejection[]
}

export interface AgentContext {
  client: AgentContextClient | null
  session: AgentContextSession
  service: AgentContextService | null
  line: AgentContextLine
  current_message: AgentContextCurrentMessage
  system_events: AgentSystemEvent[]
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface BuildAgentContextOptions {
  systemEvents?: AgentSystemEvent[]
}

export interface AgentContextResult {
  context: AgentContext
  history: AgentHistoryMessage[]
}

// Bounded to the last 40 messages (spec: "Agent context contract"), both
// directions, oldest first — replaces the 10-message window of the retired
// ResponseContract.buildAIContext.
export const AGENT_HISTORY_LIMIT = 40

// How many terminated-service rows to scan for distinct pickup place names.
// Higher than MAX_RECENT_PLACES because consecutive trips often share a
// place (a client rarely varies their pickup spot every trip).
const RECENT_SERVICES_LOOKUP_SIZE = 20
const MAX_RECENT_PLACES = 5

/**
 * Same placeholder rendering as the retired ResponseContract.buildAIContext:
 * a location becomes a fixed placeholder, an inbound interactive reply is
 * rendered by its stored reply id, everything else (including an outbound
 * interactive/list turn, already stored as its text body) is its raw text.
 */
export function renderAgentMessageText(msg: WpMessage): string {
  if (msg.location) {
    return '[ubicación compartida]'
  }

  if (!msg.fromMe && msg.type === MessageTypes.INTERACTIVE) {
    return `[opción elegida: ${msg.msg}]`
  }

  return msg.msg
}

function buildHistory(session: Session, currentMessage: WpMessage): AgentHistoryMessage[] {
  return Array.from(session.messages.values())
    .filter((msg) => msg.id !== currentMessage.id)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-AGENT_HISTORY_LIMIT)
    .map((msg) => ({
      role: msg.fromMe ? ('assistant' as const) : ('user' as const),
      text: renderAgentMessageText(msg),
    }))
}

/**
 * `is_first_reply` is precomputed here rather than left for the model to infer
 * by scanning the raw history (chatbot-agent-conversation spec, "Agent context
 * contract"), matching every other conditional fact in this object. `history`
 * is the same bounded, current-message-excluded array returned alongside the
 * context, so a genuinely first turn (no prior assistant message) yields true.
 */
function buildSessionFacts(session: Session, history: AgentHistoryMessage[]): AgentContextSession {
  return {
    status: session.status as AgentSessionStatus,
    place: session.place?.name ?? null,
    comment: session.state.comment,
    pending_candidates: session.state.pending_candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
    })),
    pending_pin_awaiting_reference: session.state.pending_pin !== null,
    is_first_reply: history.every((message) => message.role !== 'assistant'),
  }
}

function buildCurrentMessageFacts(message: WpMessage): AgentContextCurrentMessage {
  return {
    text: message.msg,
    location: message.location
      ? {
          lat: message.location.lat,
          lng: message.location.lng,
          name:
            message.location.name === MessageHelper.LOCATION_NO_NAME ? null : message.location.name,
        }
      : null,
    interactive_reply_id: message.type === MessageTypes.INTERACTIVE ? message.msg || null : null,
  }
}

function dedupeDistinctPlaceNames(services: ServiceInterface[], limit: number): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const service of services) {
    const name = service.start_loc?.name
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= limit) break
  }

  return names
}

async function buildClientFacts(chatId: string): Promise<AgentContextClient | null> {
  const client = Store.getInstance().findClientById(chatId)
  if (!client) return null

  let completedServices = 0
  let recentPlaces: string[] = []
  try {
    const canonicalClientId = ChatIdHelper.toCanonicalClientId(chatId)
    const historyRepo = Container.getServiceHistoryRepository()
    const historyFilters = {
      clientId: canonicalClientId,
      status: 'terminated',
      excludeDriverOrigin: true,
    }
    const [count, recentServices] = await Promise.all([
      historyRepo.count(historyFilters),
      historyRepo.listPage({ ...historyFilters, perPage: RECENT_SERVICES_LOOKUP_SIZE }),
    ])
    completedServices = count
    recentPlaces = dedupeDistinctPlaceNames(recentServices, MAX_RECENT_PLACES)
  } catch (error) {
    console.error(
      'AgentContextBuilder: failed to load client service history',
      chatId,
      (error as Error).message
    )
  }

  return {
    name: client.name ?? null,
    completed_services: completedServices,
    recent_places: recentPlaces,
  }
}

function colorName(color: { name: string; hex?: string } | null | undefined): string | null {
  if (!color?.name) return null
  return Locale.getInstance().__('colors.' + color.name)
}

/**
 * Same two-path resolution WhatsAppClient.serviceChanged/readServiceVehicleSnapshot
 * use: prefer the RTDB vehicle snapshot, fall back to the driver's current vehicle.
 * The plate is truncated the same way the SERVICE_ASSIGNED catalog message
 * truncates it (MessageHelper.truncatePlate), so the agent never discloses more
 * of the plate than the customer already sees elsewhere.
 */
async function resolveVehicleFacts(
  service: ServiceInterface
): Promise<{ plate: string | null; color: string | null }> {
  if (service.vehicle?.plate) {
    return {
      plate: MessageHelper.truncatePlate(service.vehicle.plate),
      color: colorName(service.vehicle.color),
    }
  }

  if (service.driver_id) {
    const vehicle = await resolveDriverCurrentVehicle(service.driver_id)
    if (vehicle?.plate) {
      return { plate: MessageHelper.truncatePlate(vehicle.plate), color: colorName(vehicle.color) }
    }
  }

  return { plate: null, color: null }
}

/**
 * `service.created_at` is unix SECONDS (Models/Service's own `dayjs().unix()`,
 * also the unit DeterministicHandlers.insistService writes back on restart) —
 * not milliseconds. Compare against DateHelper.unix() (same clock convention),
 * not Date.now(), to avoid a ~1000x inflated minute count.
 */
function minutesSince(createdAt: number): number {
  return Math.max(0, Math.floor((DateHelper.unix() - createdAt) / 60))
}

async function buildServiceFacts(session: Session): Promise<AgentContextService | null> {
  if (!session.service_id) return null

  let service: ServiceInterface
  try {
    service = await ServiceRepository.findServiceById(session.service_id)
  } catch (error) {
    console.error(
      'AgentContextBuilder: failed to load active service',
      session.service_id,
      (error as Error).message
    )
    return null
  }

  const vehicleFacts = await resolveVehicleFacts(service)
  return {
    minutes_since_created: minutesSince(service.created_at),
    driver_assigned: !!service.driver_id,
    vehicle_plate: vehicleFacts.plate,
    vehicle_color: vehicleFacts.color,
    driver_arrived: (service.metadata?.arrived_at ?? 0) > 0,
  }
}

/**
 * Single-city deployment today (see ResponseContract.findContainingPolygon,
 * hardcoded to 'popayan'): the line's city is the branch's one configured
 * city, resolved the same way self-service booking resolves its default
 * branch/city (Store.getDefaultBranchCity). A misconfigured Store (no branch,
 * or an ambiguous one) must never break a conversation turn over a cosmetic
 * fact, so this degrades to an empty string instead of throwing.
 */
function resolveLineCity(store: Store): string {
  try {
    const { cityId } = store.getDefaultBranchCity()
    return store.findCityById(cityId)?.name ?? ''
  } catch (error) {
    console.error('AgentContextBuilder: failed to resolve line city', (error as Error).message)
    return ''
  }
}

function buildLineFacts(store: Store): AgentContextLine {
  return {
    company_name: config.APP_NAME,
    pqr_number: config.PQR_NUMBER,
    city: resolveLineCity(store),
  }
}

/**
 * Builds the structured facts for one agent turn (chatbot-agent-conversation
 * spec, "Agent context contract") plus the rendered history used to build the
 * Responses API `input` (see buildAgentInput). `currentMessage` is the merged
 * unprocessed message for this turn (Session.buildMergedUnprocessedMessage).
 */
export async function buildAgentContext(
  session: Session,
  currentMessage: WpMessage,
  options: BuildAgentContextOptions = {}
): Promise<AgentContextResult> {
  const store = Store.getInstance()
  const history = buildHistory(session, currentMessage)

  const [client, service] = await Promise.all([
    buildClientFacts(session.chat_id),
    buildServiceFacts(session),
  ])

  const context: AgentContext = {
    client,
    session: buildSessionFacts(session, history),
    service,
    line: buildLineFacts(store),
    current_message: buildCurrentMessageFacts(currentMessage),
    system_events: options.systemEvents ?? [],
  }

  return { context, history }
}

/**
 * Maps a built context to the Responses API `input` array (design D2): the
 * rendered history as user/assistant message items, one `developer` item
 * carrying the JSON context, and the current merged message as the last
 * `user` item.
 */
export function buildAgentInput(
  context: AgentContext,
  history: AgentHistoryMessage[],
  currentMessage: WpMessage
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = history.map((message) => ({
    role: message.role,
    content: message.text,
  }))

  items.push({ role: 'developer', content: JSON.stringify(context) })
  items.push({ role: 'user', content: renderAgentMessageText(currentMessage) })

  return items
}
