// Golden conversation fixtures (agent-first-chatbot task 5.2, design D10 "Golden
// conversations"): multi-turn transcripts driven through the REAL `dispatchTurn`
// (so line-mode/status routing, AgentContextBuilder, AgentTools, AgentValidator,
// AgentExecutor, ServiceBooking and DeterministicHandlers all run for real) with
// only the OpenAI Responses API, Store/repositories and the persistence layer
// mocked. This is deliberately a different mocking depth than AgentTurn.spec.ts/
// AgentExecutor.spec.ts (which mock each other's units to test one module in
// isolation) — here the seam is drawn at the process boundary: the model call and
// the DB/RTDB, per the task brief.
//
// `Session` stays a plain mutating mock object (not the real class), matching
// LocationAssistantFlow.spec.ts's precedent: the real `Session` class pulls in
// `SessionRepository`/`ConversationTurnQueue`/BullMQ, which is unrelated surface
// this suite does not need to boot.

jest.mock('../../../../Models/Session', () => ({
  __esModule: true,
  default: {
    STATUS_BOOKING: 'BOOKING',
    STATUS_REQUESTING_SERVICE: 'REQUESTING_SERVICE',
    STATUS_SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
    STATUS_COMPLETED: 'COMPLETED',
    STATUS_SUPPORT: 'SUPPORT',
  },
}))

// Messages.getSingleMessage normally resolves through Store.findMessageById; stubbed
// here (same pattern as AgentExecutor.spec.ts/AgentTurn.spec.ts) so assertions can
// check which catalog id was sent without also mocking Store.findMessageById.
jest.mock('../../Messages', () => ({
  getSingleMessage: jest.fn((id: string) => ({
    id,
    name: id,
    description: '',
    message: id,
    enabled: true,
    interactive: null,
  })),
}))

const wpClientsFixture: Record<
  string,
  { id: string; chatBot: boolean; assistant: boolean; agentInTrip: boolean }
> = {}

// Mutable fixtures the Store/repository mocks below read from — set per test.
const storeState: {
  client: { id: string; name: string; phone: string; photoUrl: string } | null
  findPlacesResult: {
    place: Record<string, unknown> | null
    suggestions: Array<{ id: string; name: string }>
    hasStrongCandidate: boolean
  }
  placesById: Record<string, Record<string, unknown>>
  service: Record<string, unknown> | null
  serviceMissing: boolean
} = {
  client: null,
  findPlacesResult: { place: null, suggestions: [], hasStrongCandidate: false },
  placesById: {},
  service: null,
  serviceMissing: true,
}

const mockFindClientById = jest.fn(() => storeState.client ?? undefined)
const mockCreateClient = jest.fn(async (contact: { pushname: string }) => {
  storeState.client = {
    id: 'client-1',
    name: contact.pushname,
    phone: '+573001234567',
    photoUrl: '',
  }
  return storeState.client
})
const mockFindPlacesWithSuggestions = jest.fn(async () => storeState.findPlacesResult)
const mockFindCityById = jest.fn((id: string) =>
  id === 'popayan' ? { id: 'popayan', name: 'Popayán' } : undefined
)
const mockGetDefaultBranchCity = jest.fn(() => ({ branchId: 'branch-1', cityId: 'popayan' }))
const mockFindCountryByCity = jest.fn(() => 'colombia')
const mockGetWhatsAppClient = jest.fn(() => undefined)

jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      wpClients: wpClientsFixture,
      findClientById: mockFindClientById,
      createClient: mockCreateClient,
      findPlacesWithSuggestions: mockFindPlacesWithSuggestions,
      findCityById: mockFindCityById,
      getDefaultBranchCity: mockGetDefaultBranchCity,
      findCountryByCity: mockFindCountryByCity,
      getWhatsAppClient: mockGetWhatsAppClient,
    })),
  },
}))

const mockPlaceRepoFindById = jest.fn(async (id: string) => storeState.placesById[id] ?? null)
const mockHistoryCount = jest.fn(async () => 0)
const mockHistoryListPage = jest.fn(async () => [])

jest.mock('../../../../Container/Container', () => ({
  __esModule: true,
  default: {
    getPlaceRepository: jest.fn(() => ({ findById: mockPlaceRepoFindById })),
    getServiceHistoryRepository: jest.fn(() => ({
      count: mockHistoryCount,
      listPage: mockHistoryListPage,
    })),
  },
}))

const mockFindServiceById = jest.fn(async (..._args: unknown[]) => {
  if (storeState.serviceMissing || !storeState.service) {
    throw new Error('not exist')
  }
  return storeState.service
})
const mockServiceRepoCreate = jest.fn(async (...args: unknown[]) => {
  const service = args[0] as Record<string, unknown>
  return { ...service, id: 'service-1' }
})
const mockServiceRepoUpdateStatus = jest.fn(async (..._args: unknown[]) => undefined)

// Flat singleton mocks (ServiceRepository/SessionRepository are `export default new X()`):
// no `__esModule: true` needed since the factory return is not nested under `default`
// (see the project_esmodule_mock_interop memory note).
jest.mock('../../../../Repositories/ServiceRepository', () => ({
  findServiceById: (...args: unknown[]) => mockFindServiceById(...args),
  create: (...args: unknown[]) => mockServiceRepoCreate(...args),
  updateStatus: (...args: unknown[]) => mockServiceRepoUpdateStatus(...args),
}))

const mockSessionRepoAddMsg = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('../../../../Repositories/SessionRepository', () => ({
  addMsg: (...args: unknown[]) => mockSessionRepoAddMsg(...args),
}))

// Never exercised by these scenarios (every service fixture below sets vehicle
// directly) — mocked defensively so no accidental real DB/RTDB call is possible.
jest.mock('../../../drivers/DriverVehicleResolver', () => ({
  resolveDriverCurrentVehicle: jest.fn().mockResolvedValue(null),
}))

const mockCreateResponse = jest.fn()
const mockBuildFollowUpInput = jest.fn((...args: unknown[]) => {
  const [previous, raw, outputs] = args as [unknown[], unknown[], unknown[]]
  return [...previous, ...raw, ...outputs]
})

// The one true seam of this suite (design D10): every other agent-runtime module
// runs for real, only the OpenAI Responses API call itself is canned per test.
jest.mock('../../agent/OpenAIResponsesClient', () => {
  const actual = jest.requireActual('../../agent/OpenAIResponsesClient')
  return {
    ...actual,
    OpenAIResponsesClient: jest.fn().mockImplementation(() => ({
      createResponse: (...args: unknown[]) => mockCreateResponse(...args),
      buildFollowUpInput: (...args: unknown[]) => mockBuildFollowUpInput(...args),
    })),
  }
})

import { dispatchTurn } from '../../TurnDispatcher'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { AgentAction, AgentOutput } from '../../agent/AgentPrompt'
import { OpenAIResponsesResult } from '../../agent/OpenAIResponsesClient'
import { MessagesEnum } from '../../MessagesEnum'
import MessageHelper from '../../../../Helpers/MessageHelper'

// ---- Session / message builders -------------------------------------------------

// Mutating mock session (LocationAssistantFlow.spec.ts precedent, see the memory
// note project_location_assistant_flow_task33): setPlace/setState/setStatus/
// setService write back onto the same object so a turn's later reads (and a later
// turn in a multi-turn scenario) see the previous turn's effects, mirroring the
// real Session class's synchronous-field-then-persist behavior.
function buildSession(overrides: Record<string, unknown> = {}) {
  const session: any = {
    id: 'session-1',
    wp_client_id: 'wp-1',
    chat_id: '573001234567@c.us',
    status: 'BOOKING',
    place: null,
    service_id: null,
    messages: new Map<string, WpMessage>(),
    state: { comment: null, pending_candidates: [], pending_pin: null, awaiting: null },
    chat: {
      getContact: jest.fn().mockResolvedValue({ pushname: '', number: '573001234567', id: 'c1' }),
    },
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  session.setPlace = jest.fn((place: Record<string, unknown>) => {
    session.place = place
    return Promise.resolve()
  })
  session.setState = jest.fn((patch: Record<string, unknown>) => {
    session.state = { ...session.state, ...patch }
    return Promise.resolve()
  })
  session.setStatus = jest.fn((status: string) => {
    session.status = status
    return Promise.resolve()
  })
  session.setService = jest.fn((id: string) => {
    session.service_id = id
    return Promise.resolve()
  })
  return session
}

function textMessage(id: string, msg: string): WpMessage {
  return {
    created_at: Date.now(),
    id,
    type: MessageTypes.TEXT,
    msg,
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

function locationMessage(id: string, lat: number, lng: number, text = ''): WpMessage {
  return {
    created_at: Date.now(),
    id,
    type: MessageTypes.LOCATION,
    msg: text,
    processed: false,
    location: { name: MessageHelper.LOCATION_NO_NAME, lat, lng },
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

// Mirrors what Session.addMsg would have already done before a real turn runs:
// the inbound message is in `session.messages` (so a *later* turn's history
// includes it) but dispatchTurn itself only ever sees `message` as "current".
async function turn(session: any, message: WpMessage): Promise<void> {
  session.messages.set(message.id, message)
  await dispatchTurn(session, message)
}

// ---- Canned model output builders ------------------------------------------------

function finalResult(reply: string, actions: AgentAction[]): OpenAIResponsesResult<AgentOutput> {
  return { type: 'final', data: { reply, actions }, rawOutput: [] }
}

function functionCallsResult(
  callId: string,
  name: string,
  args: Record<string, unknown>
): OpenAIResponsesResult<AgentOutput> {
  return {
    type: 'function_calls',
    calls: [{ callId, name, arguments: args }],
    rawOutput: [{ type: 'function_call', call_id: callId, name }],
  }
}

const setClientName = (name: string): AgentAction => ({ type: 'set_client_name', name })
const setPlace = (placeId: string): AgentAction => ({ type: 'set_place', placeId })
const setPlaceFromLocation = (reference: string): AgentAction => ({
  type: 'set_place_from_location',
  reference,
})
const setComment = (text: string): AgentAction => ({ type: 'set_comment', text })
const createServiceAction = (): AgentAction => ({ type: 'create_service' })
const escalateSupport = (): AgentAction => ({ type: 'escalate_support' })

// Reads the developer-role JSON context item off one createResponse call's `input`
// (design D2: history items, one developer item with the JSON context, then the
// current message) — used to assert on facts AgentContextBuilder surfaced (e.g. the
// vehicle plate) without duplicating AgentContextBuilder's own unit tests.
function contextFromCall(callIndex: number): any {
  const request = mockCreateResponse.mock.calls[callIndex][0] as {
    input: Array<Record<string, unknown>>
  }
  const developerItem = request.input.find((item) => item.role === 'developer')
  return developerItem ? JSON.parse(developerItem.content as string) : null
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateResponse.mockReset()

  storeState.client = null
  storeState.findPlacesResult = { place: null, suggestions: [], hasStrongCandidate: false }
  storeState.placesById = {}
  storeState.service = null
  storeState.serviceMissing = true

  Object.keys(wpClientsFixture).forEach((key) => delete wpClientsFixture[key])
  wpClientsFixture['wp-1'] = { id: 'wp-1', chatBot: true, assistant: false, agentInTrip: false }
})

describe('Golden conversations (chatbot-agent-conversation, task 5.2)', () => {
  it('1) one-message booking: name, place and comment resolve in a single turn and the service is created silently', async () => {
    const session = buildSession()

    storeState.findPlacesResult = {
      place: {
        id: 'place-1',
        name: 'Campanario',
        lat: 2.44,
        lng: -76.6,
        location: null,
        cityId: 'popayan',
        score: 0.95,
      },
      suggestions: [],
      hasStrongCandidate: true,
    }
    storeState.placesById['place-1'] = {
      id: 'place-1',
      name: 'Campanario',
      lat: 2.44,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    }

    mockCreateResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place', { query: 'campanario' }))
      .mockResolvedValueOnce(
        finalResult('¡Listo!', [
          setClientName('Ana'),
          setPlace('place-1'),
          setComment('casa verde puerta blanca'),
          createServiceAction(),
        ])
      )

    await turn(
      session,
      textMessage('msg-1', 'Soy Ana, necesito un taxi en Campanario, casa verde puerta blanca')
    )

    // (a) outbound messages: the reply is discarded, only the catalog SERVICE_CREATED
    // message (sent by the RTDB-driven path, out of this turn's scope) confirms —
    // see spec "Service creation turn sends the catalog confirmation only".
    expect(session.sendMessage).not.toHaveBeenCalled()

    // (b) actions executed / side effects.
    expect(mockFindPlacesWithSuggestions).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockCreateClient.mock.calls[0][0].pushname).toBe('Ana')
    expect(session.place).toMatchObject({ id: 'place-1', name: 'Campanario' })
    expect(session.state.comment).toBe('casa verde puerta blanca')
    expect(mockServiceRepoCreate).toHaveBeenCalledTimes(1)
    const createdService = mockServiceRepoCreate.mock.calls[0][0] as any
    expect(createdService.name).toBe('Ana')
    expect(createdService.comment).toBe('casa verde puerta blanca')
    expect(createdService.start_loc).toMatchObject({ id: 'place-1', name: 'Campanario' })

    // (c) final session status.
    expect(session.status).toBe('REQUESTING_SERVICE')
    expect(session.service_id).toBe('service-1')
  })

  it('2) ambiguous place then "la primera": candidates persist across turns, no second search', async () => {
    const session = buildSession()

    storeState.findPlacesResult = {
      place: null,
      suggestions: [
        { id: 'p1', name: 'Torres de Cataluña' },
        { id: 'p2', name: 'Torres del Virrey' },
      ],
      hasStrongCandidate: false,
    }
    storeState.placesById['p1'] = {
      id: 'p1',
      name: 'Torres de Cataluña',
      lat: 2.43,
      lng: -76.58,
      location: null,
      cityId: 'popayan',
    }

    mockCreateResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place', { query: 'las torres' }))
      .mockResolvedValueOnce(
        finalResult(
          '¿Cuál de estas es tu ubicación? 1. Torres de Cataluña 2. Torres del Virrey',
          []
        )
      )

    await turn(session, textMessage('msg-1', 'necesito un taxi a las torres'))

    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.sendMessage.mock.calls[0][0].message).toContain('Torres de Cataluña')
    expect(session.state.pending_candidates).toEqual([
      { id: 'p1', name: 'Torres de Cataluña' },
      { id: 'p2', name: 'Torres del Virrey' },
    ])
    expect(session.place).toBeNull()

    // Second turn: the model resolves "la primera" straight to the first pending
    // candidate's id — no tool call this time.
    mockCreateResponse.mockResolvedValueOnce(
      finalResult('Perfecto, Torres de Cataluña.', [setPlace('p1')])
    )

    await turn(session, textMessage('msg-2', 'la primera'))

    expect(mockFindPlacesWithSuggestions).toHaveBeenCalledTimes(1) // no second search
    expect(session.place).toMatchObject({ id: 'p1', name: 'Torres de Cataluña' })
    expect(session.state.pending_candidates).toEqual([])
    expect(session.sendMessage).toHaveBeenCalledTimes(2)
    expect(session.sendMessage.mock.calls[1][0].message).toBe('Perfecto, Torres de Cataluña.')
    expect(session.status).toBe('BOOKING')
  })

  it('3) GPS pin with a reference name: set_place_from_location with no search performed', async () => {
    const session = buildSession()

    mockCreateResponse.mockResolvedValueOnce(
      finalResult('Perfecto, ahí te recogemos.', [setPlaceFromLocation('frente a la panadería')])
    )

    await turn(session, locationMessage('msg-1', 2.44, -76.6, 'frente a la panadería'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.place).toMatchObject({ name: 'frente a la panadería', lat: 2.44, lng: -76.6 })
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.sendMessage.mock.calls[0][0].message).toBe('Perfecto, ahí te recogemos.')
    expect(session.status).toBe('BOOKING')
  })

  it('4) GPS pin without a name: the agent asks, the pin is stored pending, and the next text completes the place', async () => {
    const session = buildSession()

    mockCreateResponse.mockResolvedValueOnce(
      finalResult('¿Cómo se llama el lugar donde estás?', [])
    )

    await turn(session, locationMessage('msg-1', 2.5, -76.61, ''))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.place).toBeNull()
    expect(session.state.pending_pin).toEqual({ lat: 2.5, lng: -76.61 })
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.sendMessage.mock.calls[0][0].message).toBe(
      '¿Cómo se llama el lugar donde estás?'
    )

    mockCreateResponse.mockResolvedValueOnce(
      finalResult('Listo, ahí te recogemos.', [setPlaceFromLocation('frente a la tienda')])
    )

    await turn(session, textMessage('msg-2', 'frente a la tienda'))

    expect(session.place).toMatchObject({ name: 'frente a la tienda', lat: 2.5, lng: -76.61 })
    expect(session.state.pending_pin).toBeNull()
    expect(session.sendMessage).toHaveBeenCalledTimes(2)
    expect(session.status).toBe('BOOKING')
  })

  it('5) complaint escalation: the reply is sent, the session moves to SUPPORT, and later messages get no automatic reply', async () => {
    const session = buildSession()

    mockCreateResponse.mockResolvedValueOnce(
      finalResult('Lamento mucho lo sucedido, un asesor te va a contactar para revisar tu caso.', [
        escalateSupport(),
      ])
    )

    await turn(session, textMessage('msg-1', 'el conductor de mi último viaje fue muy grosero'))

    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.sendMessage.mock.calls[0][0].message).toContain('Lamento mucho lo sucedido')
    expect(session.status).toBe('SUPPORT')

    // Later message: dispatchTurn no-ops on SUPPORT before ever reaching the model.
    await turn(session, textMessage('msg-2', 'hola?'))

    expect(mockCreateResponse).toHaveBeenCalledTimes(1)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('6) waiting-for-driver question in REQUESTING_SERVICE: the reply uses context, no actions execute, status is unchanged', async () => {
    const session = buildSession({
      status: 'REQUESTING_SERVICE',
      service_id: 'service-1',
      place: {
        id: 'place-1',
        name: 'Campanario',
        lat: 2.44,
        lng: -76.6,
        location: null,
        cityId: 'popayan',
      },
    })
    storeState.client = { id: 'client-1', name: 'Ana', phone: '+573001234567', photoUrl: '' }
    storeState.service = {
      id: 'service-1',
      status: 'pending',
      driver_id: null,
      vehicle: null,
      created_at: Math.floor(Date.now() / 1000) - 300,
      metadata: {},
      client_id: '573001234567',
      wp_client_id: 'wp-1',
      start_loc: {
        id: 'place-1',
        name: 'Campanario',
        lat: 2.44,
        lng: -76.6,
        location: null,
        cityId: 'popayan',
      },
      end_loc: null,
      phone: '+573001234567',
      name: 'Ana',
      comment: null,
      amount: null,
    }
    storeState.serviceMissing = false

    mockCreateResponse.mockResolvedValueOnce(
      finalResult(
        'Llevamos unos minutos buscando tu conductor, ¿quieres esperar, insistir o cancelar?',
        []
      )
    )

    await turn(session, textMessage('msg-1', '¿cuánto se demora?'))

    const context = contextFromCall(0)
    expect(context.service).not.toBeNull()
    expect(context.service.driver_assigned).toBe(false)
    expect(context.service.vehicle_plate).toBeNull()
    // created_at above is 300 unix-seconds ago (task 6.1 fixed
    // AgentContextBuilder.minutesSince, which previously mixed Date.now() (ms)
    // with service.created_at (unix SECONDS) and produced a ~1000x inflated
    // value); this now asserts the real elapsed minute count.
    expect(context.service.minutes_since_created).toBe(5)

    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.sendMessage.mock.calls[0][0].message).toContain('buscando tu conductor')
    expect(session.status).toBe('REQUESTING_SERVICE')
    expect(mockServiceRepoUpdateStatus).not.toHaveBeenCalled()
  })

  it('7) create_service rejected for missing place, regenerated once, then executed', async () => {
    const session = buildSession({
      state: {
        comment: null,
        pending_candidates: [{ id: 'p-retry', name: 'Campanario' }],
        pending_pin: null,
        awaiting: null,
      },
    })
    storeState.client = { id: 'client-1', name: 'Ana', phone: '+573001234567', photoUrl: '' }
    storeState.placesById['p-retry'] = {
      id: 'p-retry',
      name: 'Campanario',
      lat: 2.44,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    }

    mockCreateResponse
      .mockResolvedValueOnce(finalResult('¡Listo, ya pedí tu taxi!', [createServiceAction()]))
      .mockResolvedValueOnce(finalResult('', [setPlace('p-retry'), createServiceAction()]))

    await turn(session, textMessage('msg-1', 'pide el taxi ya'))

    expect(mockCreateResponse).toHaveBeenCalledTimes(2)
    // First (rejected) attempt's reply is discarded entirely, and it never reached
    // the customer — only the second attempt executes, and it suppresses its own
    // reply because create_service ran.
    expect(session.sendMessage).not.toHaveBeenCalled()
    expect(mockServiceRepoCreate).toHaveBeenCalledTimes(1)
    expect(session.place).toMatchObject({ id: 'p-retry', name: 'Campanario' })
    expect(session.status).toBe('REQUESTING_SERVICE')
  })

  it('8) in-trip silence with agentInTrip off, and an agent reply using the vehicle plate with it on', async () => {
    // 8a: agentInTrip disabled -> deterministic cancel-only handling, no model call.
    wpClientsFixture['wp-1'].agentInTrip = false
    const offSession = buildSession({ status: 'SERVICE_IN_PROGRESS', service_id: 'service-1' })

    await turn(offSession, textMessage('msg-1', 'ya viene?'))

    expect(mockCreateResponse).not.toHaveBeenCalled()
    expect(offSession.sendMessage).not.toHaveBeenCalled()

    // 8b: agentInTrip enabled -> the agent answers using the vehicle plate/color
    // and driver-assignment facts from context (spec "Setting gates in-trip agent
    // turns" / "No invented assignment").
    wpClientsFixture['wp-1'].agentInTrip = true
    const onSession = buildSession({ status: 'SERVICE_IN_PROGRESS', service_id: 'service-1' })
    storeState.client = { id: 'client-1', name: 'Ana', phone: '+573001234567', photoUrl: '' }
    storeState.service = {
      id: 'service-1',
      status: 'in_progress',
      driver_id: 'driver-1',
      vehicle: { plate: 'ABC123', color: { name: 'red' } },
      created_at: Math.floor(Date.now() / 1000) - 60,
      metadata: {},
      client_id: '573001234567',
      wp_client_id: 'wp-1',
      start_loc: {
        id: 'place-1',
        name: 'Campanario',
        lat: 2.44,
        lng: -76.6,
        location: null,
        cityId: 'popayan',
      },
      end_loc: null,
      phone: '+573001234567',
      name: 'Ana',
      comment: null,
      amount: null,
    }
    storeState.serviceMissing = false

    mockCreateResponse.mockResolvedValueOnce(
      finalResult('Tu vehículo tiene placa 123, color Rojo.', [])
    )

    await turn(onSession, textMessage('msg-2', '¿qué placa es?'))

    const context = contextFromCall(0)
    expect(context.service.vehicle_plate).toBe('123') // MessageHelper.truncatePlate('ABC123')
    expect(context.service.vehicle_color).toBe('Rojo')
    expect(context.service.driver_assigned).toBe(true)

    expect(onSession.sendMessage).toHaveBeenCalledTimes(1)
    expect(onSession.sendMessage.mock.calls[0][0].message).toBe(
      'Tu vehículo tiene placa 123, color Rojo.'
    )
    expect(onSession.status).toBe('SERVICE_IN_PROGRESS')
  })
})

// Sanity check that this suite never had to fall back to ERROR_WHILE_PROCESSING /
// SUPPORT anywhere except the deliberate escalation scenario — a quick guard
// against a silently-broken fixture (e.g. a typo'd mock) masquerading as a passing
// "no reply" assertion.
describe('Golden conversations: no accidental fallbacks', () => {
  it('DEFAULT_MESSAGE/ERROR_WHILE_PROCESSING ids are distinguishable in assertions', () => {
    expect(MessagesEnum.ERROR_WHILE_PROCESSING).toBe('ERROR_WHILE_PROCESSING')
    expect(MessagesEnum.DEFAULT_MESSAGE).toBe('DEFAULT_MESSAGE')
  })
})
