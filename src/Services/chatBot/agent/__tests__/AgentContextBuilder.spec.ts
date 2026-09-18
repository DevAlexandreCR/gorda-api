const mockFindClientById = jest.fn()
const mockGetDefaultBranchCity = jest.fn()
const mockFindCityById = jest.fn()

jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findClientById: mockFindClientById,
      getDefaultBranchCity: mockGetDefaultBranchCity,
      findCityById: mockFindCityById,
    })),
  },
}))

const mockHistoryCount = jest.fn()
const mockHistoryListPage = jest.fn()

jest.mock('../../../../Container/Container', () => ({
  __esModule: true,
  default: {
    getServiceHistoryRepository: jest.fn(() => ({
      count: mockHistoryCount,
      listPage: mockHistoryListPage,
    })),
  },
}))

const mockFindServiceById = jest.fn()

jest.mock('../../../../Repositories/ServiceRepository', () => ({
  __esModule: true,
  default: { findServiceById: mockFindServiceById },
}))

const mockResolveDriverCurrentVehicle = jest.fn()

jest.mock('../../../drivers/DriverVehicleResolver', () => ({
  resolveDriverCurrentVehicle: mockResolveDriverCurrentVehicle,
}))

import {
  buildAgentContext,
  buildAgentInput,
  AGENT_HISTORY_LIMIT,
  AgentContext,
  AgentHistoryMessage,
} from '../AgentContextBuilder'
import { EMPTY_SESSION_STATE, SessionState } from '../../../../Types/SessionState'
import { WpMessage } from '../../../../Types/WpMessage'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { ServiceInterface } from '../../../../Interfaces/ServiceInterface'

const mockPlace: PlaceInterface = {
  id: 'place-1',
  name: 'Campanario',
  lat: 2.44,
  lng: -76.6,
  location: null,
  cityId: 'popayan',
}

const mockClient: ClientInterface = {
  id: '573001234567',
  name: 'Ana',
  phone: '+573001234567',
  photoUrl: '',
}

function textMsg(id: string, created_at: number, fromMe: boolean, msg: string): WpMessage {
  return {
    created_at,
    id,
    type: MessageTypes.TEXT,
    msg,
    processed: true,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe,
  }
}

function buildMockSession(
  overrides: Partial<{
    status: string
    place: PlaceInterface | null
    state: SessionState
    service_id: string | null
    messages: Map<string, WpMessage>
  }> = {}
) {
  return {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    wp_client_id: 'wp-client-1',
    status: overrides.status ?? 'BOOKING',
    place: overrides.place ?? null,
    state: overrides.state ?? { ...EMPTY_SESSION_STATE },
    service_id: overrides.service_id ?? null,
    messages: overrides.messages ?? new Map<string, WpMessage>(),
  }
}

function baseService(overrides: Partial<ServiceInterface> = {}): ServiceInterface {
  return {
    id: 'service-1',
    status: 'pending',
    start_loc: mockPlace,
    end_loc: null,
    phone: mockClient.phone,
    name: mockClient.name,
    comment: null,
    amount: null,
    metadata: {},
    driver_id: null,
    client_id: '573001234567',
    // Unix SECONDS, matching Models/Service's own `dayjs().unix()` — see the
    // "minutes_since_created" tests below for the millisecond-vs-second bug
    // this must not regress into.
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDefaultBranchCity.mockReturnValue({ branchId: 'branch-1', cityId: 'popayan' })
  mockFindCityById.mockReturnValue({
    id: 'popayan',
    branchId: 'branch-1',
    name: 'Popayán',
    percentage: 1,
    location: { lat: 0, lng: 0 },
    polygon: [],
  })
})

describe('buildAgentContext', () => {
  it('brand-new customer: null client, empty history, BOOKING status, no service, line facts present', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()
    const current = textMsg('current', 100, false, 'hola')
    session.messages.set(current.id, current)

    const { context, history } = await buildAgentContext(session as any, current)

    expect(context.client).toBeNull()
    expect(history).toEqual([])
    expect(context.session).toEqual({
      status: 'BOOKING',
      place: null,
      comment: null,
      pending_candidates: [],
      pending_pin_awaiting_reference: false,
    })
    expect(context.service).toBeNull()
    expect(context.line).toEqual({
      company_name: expect.any(String),
      pqr_number: expect.any(String),
      city: 'Popayán',
    })
    expect(mockHistoryCount).not.toHaveBeenCalled()
  })

  it('waiting-for-driver: REQUESTING_SERVICE with elapsed minutes and no driver assigned', async () => {
    mockFindClientById.mockReturnValue(mockClient)
    mockHistoryCount.mockResolvedValue(2)
    mockHistoryListPage.mockResolvedValue([])
    mockFindServiceById.mockResolvedValue(
      baseService({ created_at: Math.floor(Date.now() / 1000) - 6 * 60, driver_id: null })
    )

    const session = buildMockSession({
      status: 'REQUESTING_SERVICE',
      place: mockPlace,
      service_id: 'service-1',
    })
    const current = textMsg('current', 100, false, '¿cuánto se demora?')
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(context.client).toEqual({ name: 'Ana', completed_services: 2, recent_places: [] })
    expect(context.session.status).toBe('REQUESTING_SERVICE')
    expect(context.session.place).toBe('Campanario')
    expect(context.service).toEqual({
      minutes_since_created: 6,
      driver_assigned: false,
      vehicle_plate: null,
      vehicle_color: null,
      driver_arrived: false,
    })
    expect(mockResolveDriverCurrentVehicle).not.toHaveBeenCalled()
  })

  it('in-trip: SERVICE_IN_PROGRESS with plate, color and arrived flag known', async () => {
    mockFindClientById.mockReturnValue(mockClient)
    mockHistoryCount.mockResolvedValue(5)
    mockHistoryListPage.mockResolvedValue([
      baseService({ start_loc: { ...mockPlace, name: 'Campanario' } }),
      baseService({ start_loc: { ...mockPlace, name: 'Campanario' } }),
      baseService({ start_loc: { ...mockPlace, name: 'Centro' } }),
    ])
    mockFindServiceById.mockResolvedValue(
      baseService({
        driver_id: 'driver-1',
        vehicle: { plate: 'ABC123', color: { name: 'white' } },
        metadata: { arrived_at: Date.now() },
      })
    )

    const session = buildMockSession({
      status: 'SERVICE_IN_PROGRESS',
      place: mockPlace,
      service_id: 'service-1',
    })
    const current = textMsg('current', 100, false, 'ya llegó?')
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(context.client).toEqual({
      name: 'Ana',
      completed_services: 5,
      recent_places: ['Campanario', 'Centro'],
    })
    expect(context.service).toEqual({
      minutes_since_created: 0,
      driver_assigned: true,
      vehicle_plate: '123',
      vehicle_color: 'Blanco',
      driver_arrived: true,
    })
    expect(mockResolveDriverCurrentVehicle).not.toHaveBeenCalled()
  })

  it('computes minutes_since_created from unix-seconds created_at, not milliseconds', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00Z'))
    try {
      mockFindClientById.mockReturnValue(mockClient)
      mockHistoryCount.mockResolvedValue(0)
      mockHistoryListPage.mockResolvedValue([])
      const nowUnixSeconds = Math.floor(Date.now() / 1000)
      mockFindServiceById.mockResolvedValue(
        baseService({ created_at: nowUnixSeconds - 17 * 60, driver_id: null })
      )

      const session = buildMockSession({
        status: 'REQUESTING_SERVICE',
        place: mockPlace,
        service_id: 'service-1',
      })
      const current = textMsg('current', 100, false, '¿ya viene?')
      session.messages.set(current.id, current)

      const { context } = await buildAgentContext(session as any, current)

      expect(context.service?.minutes_since_created).toBe(17)
    } finally {
      jest.useRealTimers()
    }
  })

  it('falls back to the driver current vehicle when the service has no vehicle snapshot', async () => {
    mockFindClientById.mockReturnValue(mockClient)
    mockHistoryCount.mockResolvedValue(0)
    mockHistoryListPage.mockResolvedValue([])
    mockFindServiceById.mockResolvedValue(baseService({ driver_id: 'driver-1', vehicle: null }))
    mockResolveDriverCurrentVehicle.mockResolvedValue({ plate: 'XYZ987', color: { name: 'red' } })

    const session = buildMockSession({
      status: 'SERVICE_IN_PROGRESS',
      place: mockPlace,
      service_id: 'service-1',
    })
    const current = textMsg('current', 100, false, 'hola')
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(mockResolveDriverCurrentVehicle).toHaveBeenCalledWith('driver-1')
    expect(context.service?.vehicle_plate).toBe('987')
    expect(context.service?.vehicle_color).toBe('Rojo')
  })

  it('carries session.state pending candidates and pending-pin flag verbatim', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const state: SessionState = {
      comment: 'casa verde',
      pending_candidates: [{ id: 'p1', name: 'Estación de Policía' }],
      pending_pin: { lat: 2.4, lng: -76.6 },
      awaiting: null,
    }
    const session = buildMockSession({ state })
    const current = textMsg('current', 100, false, 'hola')
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(context.session.comment).toBe('casa verde')
    expect(context.session.pending_candidates).toEqual([{ id: 'p1', name: 'Estación de Policía' }])
    expect(context.session.pending_pin_awaiting_reference).toBe(true)
  })

  it('carries the current message GPS location and interactive reply id', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()
    const current: WpMessage = {
      created_at: 100,
      id: 'current',
      type: MessageTypes.LOCATION,
      msg: '',
      processed: false,
      location: { name: 'frente a la panadería', lat: 2.4, lng: -76.6 },
      interactiveReply: null,
      interactive: null,
      fromMe: false,
    }
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(context.current_message).toEqual({
      text: '',
      location: { lat: 2.4, lng: -76.6, name: 'frente a la panadería' },
      interactive_reply_id: null,
    })
  })

  it('reports a null location name for the location-no-name sentinel', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()
    const current: WpMessage = {
      created_at: 100,
      id: 'current',
      type: MessageTypes.LOCATION,
      msg: '',
      processed: false,
      location: { name: 'location-no-name', lat: 2.4, lng: -76.6 },
      interactiveReply: null,
      interactive: null,
      fromMe: false,
    }
    session.messages.set(current.id, current)

    const { context } = await buildAgentContext(session as any, current)

    expect(context.current_message.location?.name).toBeNull()
  })

  it('forwards system events passed in by the caller, defaulting to an empty list', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()
    const current = textMsg('current', 100, false, 'hola')
    session.messages.set(current.id, current)

    const { context: withoutEvents } = await buildAgentContext(session as any, current)
    expect(withoutEvents.system_events).toEqual([])

    const { context: withEvents } = await buildAgentContext(session as any, current, {
      systemEvents: [
        {
          type: 'action_rejected',
          rejections: [{ action: 'set_place("abc123")', reason: 'id not seen this turn' }],
        },
      ],
    })
    expect(withEvents.system_events).toEqual([
      {
        type: 'action_rejected',
        rejections: [{ action: 'set_place("abc123")', reason: 'id not seen this turn' }],
      },
    ])
  })

  it('bounds history to the last 40 messages, oldest first, excluding the current message', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()

    for (let i = 1; i <= 45; i++) {
      const msg = textMsg(`msg-${i}`, i * 1000, i % 2 === 0, `text ${i}`)
      session.messages.set(msg.id, msg)
    }
    const current = textMsg('current', 46000, false, 'current message')
    session.messages.set(current.id, current)

    const { history } = await buildAgentContext(session as any, current)

    expect(history).toHaveLength(AGENT_HISTORY_LIMIT)
    expect(history[0].text).toBe('text 6')
    expect(history[AGENT_HISTORY_LIMIT - 1].text).toBe('text 45')
    expect(history.some((h) => h.text === 'current message')).toBe(false)
  })

  it('renders location and inbound-interactive history entries with the existing placeholders', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()

    const loc: WpMessage = {
      created_at: 100,
      id: 'm1',
      type: MessageTypes.LOCATION,
      msg: '',
      processed: true,
      location: { name: 'Casa', lat: 2.4, lng: -76.6 },
      interactiveReply: null,
      interactive: null,
      fromMe: false,
    }
    const interactive: WpMessage = {
      created_at: 200,
      id: 'm2',
      type: MessageTypes.INTERACTIVE,
      msg: 'option_1',
      processed: true,
      location: null,
      interactiveReply: null,
      interactive: null,
      fromMe: false,
    }
    session.messages.set(loc.id, loc)
    session.messages.set(interactive.id, interactive)
    const current = textMsg('current', 300, false, 'current')
    session.messages.set(current.id, current)

    const { history } = await buildAgentContext(session as any, current)

    expect(history).toEqual([
      { role: 'user', text: '[ubicación compartida]' },
      { role: 'user', text: '[opción elegida: option_1]' },
    ])
  })

  // Ported from the retired ResponseContract.buildAIContext.spec.ts (task 3.4/5.1).
  it('labels fromMe: true as assistant and fromMe: false as user', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()

    const inbound = textMsg('m1', 100, false, 'user text')
    const outbound = textMsg('m2', 200, true, 'bot text')
    session.messages.set(inbound.id, inbound)
    session.messages.set(outbound.id, outbound)
    const current = textMsg('current', 300, false, 'current')
    session.messages.set(current.id, current)

    const { history } = await buildAgentContext(session as any, current)

    expect(history).toEqual([
      { role: 'user', text: 'user text' },
      { role: 'assistant', text: 'bot text' },
    ])
  })

  // Ported from the retired ResponseContract.buildAIContext.spec.ts (task 3.4/5.1).
  it('renders an outbound interactive/list turn as its stored text body, not the reply-id placeholder', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()

    const outboundInteractive: WpMessage = {
      created_at: 100,
      id: 'm1',
      type: MessageTypes.INTERACTIVE,
      msg: '¿En qué barrio te recogemos?',
      processed: true,
      location: null,
      interactiveReply: null,
      interactive: null,
      fromMe: true,
    }
    session.messages.set(outboundInteractive.id, outboundInteractive)
    const current = textMsg('current', 200, false, 'current')
    session.messages.set(current.id, current)

    const { history } = await buildAgentContext(session as any, current)

    expect(history).toEqual([{ role: 'assistant', text: '¿En qué barrio te recogemos?' }])
  })

  // Ported from the retired ResponseContract.buildAIContext.spec.ts (task 3.4/5.1).
  it('sorts by created_at rather than Map insertion order', async () => {
    mockFindClientById.mockReturnValue(undefined)
    const session = buildMockSession()

    // Inserted out of chronological order
    const second = textMsg('m2', 200, false, 'second')
    const first = textMsg('m1', 100, false, 'first')
    session.messages.set(second.id, second)
    session.messages.set(first.id, first)
    const current = textMsg('current', 300, false, 'current')
    session.messages.set(current.id, current)

    const { history } = await buildAgentContext(session as any, current)

    expect(history.map((h) => h.text)).toEqual(['first', 'second'])
  })
})

describe('buildAgentInput', () => {
  it('maps history to message items, then a developer item with the JSON context, then the current message as the last user item', () => {
    const context: AgentContext = {
      client: null,
      session: {
        status: 'BOOKING',
        place: null,
        comment: null,
        pending_candidates: [],
        pending_pin_awaiting_reference: false,
      },
      service: null,
      line: { company_name: 'Gorda', pqr_number: '3000000000', city: 'Popayán' },
      current_message: { text: 'hola', location: null, interactive_reply_id: null },
      system_events: [],
    }
    const history: AgentHistoryMessage[] = [
      { role: 'user', text: 'hola' },
      { role: 'assistant', text: 'hola, en qué te ayudo' },
    ]
    const current = textMsg('current', 100, false, 'necesito un taxi')

    const input = buildAgentInput(context, history, current)

    expect(input).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola, en qué te ayudo' },
      { role: 'developer', content: JSON.stringify(context) },
      { role: 'user', content: 'necesito un taxi' },
    ])
  })

  it('renders the current message with the same placeholder rules as history (e.g. a location)', () => {
    const context: AgentContext = {
      client: null,
      session: {
        status: 'BOOKING',
        place: null,
        comment: null,
        pending_candidates: [],
        pending_pin_awaiting_reference: false,
      },
      service: null,
      line: { company_name: 'Gorda', pqr_number: '3000000000', city: 'Popayán' },
      current_message: {
        text: '',
        location: { lat: 2.4, lng: -76.6, name: null },
        interactive_reply_id: null,
      },
      system_events: [],
    }
    const current: WpMessage = {
      created_at: 100,
      id: 'current',
      type: MessageTypes.LOCATION,
      msg: '',
      processed: false,
      location: { name: 'location-no-name', lat: 2.4, lng: -76.6 },
      interactiveReply: null,
      interactive: null,
      fromMe: false,
    }

    const input = buildAgentInput(context, [], current)

    expect(input[input.length - 1]).toEqual({ role: 'user', content: '[ubicación compartida]' })
  })
})
