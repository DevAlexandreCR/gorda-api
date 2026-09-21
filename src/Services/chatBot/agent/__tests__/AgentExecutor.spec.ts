jest.mock('../../../../Models/Session', () => ({
  __esModule: true,
  default: { STATUS_COMPLETED: 'COMPLETED', STATUS_SUPPORT: 'SUPPORT' },
}))

// Messages.getSingleMessage normally resolves through Store.findMessageById;
// stubbed here (same pattern as DeterministicHandlers.spec.ts) so these tests assert
// only on which catalog id was requested, not on Messages/Store's own resolution.
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

const mockFindById = jest.fn()
jest.mock('../../../../Container/Container', () => ({
  __esModule: true,
  default: { getPlaceRepository: jest.fn(() => ({ findById: mockFindById })) },
}))

const mockFindCityById = jest.fn()
const mockFindClientById = jest.fn()
const mockCreateClient = jest.fn()
jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findCityById: mockFindCityById,
      findClientById: mockFindClientById,
      createClient: mockCreateClient,
    })),
  },
}))

const mockBookService = jest.fn()
jest.mock('../../ServiceBooking', () => ({
  bookService: (...args: unknown[]) => mockBookService(...args),
}))

const mockCancelService = jest.fn()
const mockInsistService = jest.fn()
jest.mock('../../deterministic/DeterministicHandlers', () => ({
  cancelService: (...args: unknown[]) => mockCancelService(...args),
  insistService: (...args: unknown[]) => mockInsistService(...args),
}))

import { executeAgentActions, storePendingPin, AgentExecutorContext } from '../AgentExecutor'
import { AgentAction } from '../AgentPrompt'
import { MessagesEnum } from '../../MessagesEnum'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'

function buildMessage(overrides: Partial<WpMessage> = {}): WpMessage {
  return {
    created_at: 0,
    id: 'msg-1',
    type: MessageTypes.TEXT,
    msg: '',
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
    ...overrides,
  }
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    place: null as PlaceInterface | null,
    state: { comment: null, pending_candidates: [], pending_pin: null, awaiting: null },
    chat: { getContact: jest.fn().mockResolvedValue({ pushname: '', number: '573', id: 'c1' }) },
    setPlace: jest.fn().mockResolvedValue(undefined),
    setState: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildCtx(overrides: Partial<AgentExecutorContext> = {}): AgentExecutorContext {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    currentMessage: buildMessage(),
    placeCandidates: [],
    ...overrides,
  }
}

describe('AgentExecutor.executeAgentActions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('set_client_name: fetches the WhatsApp contact, normalizes the name, and creates the client', async () => {
    const session = buildSession()
    const ctx = buildCtx()

    const result = await executeAgentActions(
      session as any,
      [{ type: 'set_client_name', name: 'ana maría' }] as AgentAction[],
      ctx
    )

    expect(session.chat.getContact).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    const contact = mockCreateClient.mock.calls[0][0]
    expect(contact.pushname).toBe('Ana María')
    expect(result).toEqual({ executed: ['set_client_name'], suppressReply: false })
  })

  it('set_place: loads the place by id, sets it on the session, and clears pending_candidates', async () => {
    const session = buildSession()
    const ctx = buildCtx()
    const place: PlaceInterface = {
      id: 'p1',
      name: 'Campanario',
      lat: 2.4,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    }
    mockFindById.mockResolvedValue(place)

    const result = await executeAgentActions(
      session as any,
      [{ type: 'set_place', placeId: 'p1' }] as AgentAction[],
      ctx
    )

    expect(mockFindById).toHaveBeenCalledWith('p1')
    expect(session.setPlace).toHaveBeenCalledWith(place)
    expect(session.setState).toHaveBeenCalledWith({ pending_candidates: [] })
    expect(result.executed).toEqual(['set_place'])
  })

  it('set_place: skips defensively (no throw), and is NOT reported in executed, when the repository returns nothing for a validated id', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = buildSession()
    const ctx = buildCtx({ placeCandidates: [{ id: 'p1', name: 'Campanario' }] })
    mockFindById.mockResolvedValue(null)

    const result = await executeAgentActions(
      session as any,
      [
        { type: 'set_place', placeId: 'p1' },
        { type: 'set_comment', text: 'still runs' },
      ] as AgentAction[],
      ctx
    )

    expect(session.setPlace).not.toHaveBeenCalled()
    expect(result.executed).toEqual(['set_comment'])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'AgentExecutor: set_place id not found in repository',
      session.id,
      'p1',
      { fallbackName: 'Campanario' }
    )
    consoleErrorSpy.mockRestore()
  })

  it('set_place_from_location: builds the place from the current message pin and reference', async () => {
    const session = buildSession()
    const ctx = buildCtx({
      currentMessage: buildMessage({ location: { name: 'pin', lat: 2.44, lng: -76.6 } }),
    })
    mockFindCityById.mockReturnValue({ id: 'popayan' })

    const result = await executeAgentActions(
      session as any,
      [{ type: 'set_place_from_location', reference: 'frente a la panadería' }] as AgentAction[],
      ctx
    )

    expect(mockFindCityById).toHaveBeenCalledWith('popayan')
    expect(session.setPlace).toHaveBeenCalledWith({
      id: '',
      name: 'frente a la panadería',
      lat: 2.44,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    })
    expect(session.setState).toHaveBeenCalledWith({ pending_pin: null })
    expect(result).toEqual({ executed: ['set_place_from_location'], suppressReply: false })
  })

  it('set_place_from_location: falls back to session.state.pending_pin when the current turn has no location', async () => {
    const session = buildSession({
      state: {
        comment: null,
        pending_candidates: [],
        pending_pin: { lat: 1, lng: 2 },
        awaiting: null,
      },
    })
    const ctx = buildCtx({ currentMessage: buildMessage({ location: null }) })
    mockFindCityById.mockReturnValue({ id: 'popayan' })

    await executeAgentActions(
      session as any,
      [{ type: 'set_place_from_location', reference: 'la esquina' }] as AgentAction[],
      ctx
    )

    expect(session.setPlace).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 1, lng: 2, name: 'la esquina' })
    )
  })

  it('set_place_from_location: not reported in executed when there is neither a location this turn nor a pending pin', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = buildSession()
    const ctx = buildCtx({ currentMessage: buildMessage({ location: null }) })

    const result = await executeAgentActions(
      session as any,
      [
        { type: 'set_place_from_location', reference: 'la esquina' },
        { type: 'set_comment', text: 'still runs' },
      ] as AgentAction[],
      ctx
    )

    expect(session.setPlace).not.toHaveBeenCalled()
    expect(result.executed).toEqual(['set_comment'])
    consoleErrorSpy.mockRestore()
  })

  it('set_place_from_location: outside coverage sends NON_COVERED_AREA, completes the session, and halts the turn', async () => {
    const session = buildSession()
    const sendMessage = jest.fn().mockResolvedValue(undefined)
    const ctx = buildCtx({
      sendMessage,
      currentMessage: buildMessage({ location: { name: 'pin', lat: 0, lng: 0 } }),
    })
    mockFindCityById.mockReturnValue(undefined)

    const result = await executeAgentActions(
      session as any,
      [
        { type: 'set_place_from_location', reference: 'lejos' },
        { type: 'set_comment', text: 'should not run' },
      ] as AgentAction[],
      ctx
    )

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: MessagesEnum.NON_COVERED_AREA })
    )
    expect(session.setStatus).toHaveBeenCalledWith('COMPLETED')
    expect(session.setPlace).not.toHaveBeenCalled()
    // No place was applied here — the pin resolved but fell outside coverage — so
    // `executed` must not claim set_place_from_location, even though `halted` already
    // stops the loop on its own.
    expect(result).toEqual({
      executed: [],
      suppressReply: false,
      halted: 'non_covered_area',
    })
  })

  it('set_comment: stores the comment on session.state', async () => {
    const session = buildSession()
    const ctx = buildCtx()

    await executeAgentActions(
      session as any,
      [{ type: 'set_comment', text: 'casa verde puerta blanca' }] as AgentAction[],
      ctx
    )

    expect(session.setState).toHaveBeenCalledWith({ comment: 'casa verde puerta blanca' })
  })

  it('create_service: books the service with the session place, current client and stored comment, and suppresses the reply', async () => {
    const place: PlaceInterface = {
      id: 'p1',
      name: 'Campanario',
      lat: 2.4,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    }
    const client: ClientInterface = { id: 'c1', name: 'Ana', phone: '+573', photoUrl: '' }
    const session = buildSession({
      place,
      state: { comment: 'casa verde', pending_candidates: [], pending_pin: null, awaiting: null },
    })
    mockFindClientById.mockReturnValue(client)
    const ctx = buildCtx()

    const result = await executeAgentActions(
      session as any,
      [{ type: 'create_service' }] as AgentAction[],
      ctx
    )

    expect(mockFindClientById).toHaveBeenCalledWith(session.chat_id)
    expect(mockBookService).toHaveBeenCalledWith(session, {
      place,
      client,
      comment: 'casa verde',
      sendMessage: ctx.sendMessage,
    })
    expect(result).toEqual({ executed: ['create_service'], suppressReply: true })
  })

  it('create_service: skips defensively when the session has no place or no client is cached', async () => {
    const session = buildSession()
    mockFindClientById.mockReturnValue(undefined)
    const ctx = buildCtx()

    const result = await executeAgentActions(
      session as any,
      [{ type: 'create_service' }] as AgentAction[],
      ctx
    )

    expect(mockBookService).not.toHaveBeenCalled()
    expect(result.suppressReply).toBe(true)
  })

  it('cancel_service: delegates to DeterministicHandlers.cancelService', async () => {
    const session = buildSession()
    const ctx = buildCtx()

    await executeAgentActions(session as any, [{ type: 'cancel_service' }] as AgentAction[], ctx)

    expect(mockCancelService).toHaveBeenCalledWith(session)
  })

  it('insist_service: delegates to DeterministicHandlers.insistService with the turn sendMessage', async () => {
    const session = buildSession()
    const ctx = buildCtx()

    await executeAgentActions(session as any, [{ type: 'insist_service' }] as AgentAction[], ctx)

    expect(mockInsistService).toHaveBeenCalledWith(session, ctx.sendMessage)
  })

  it('escalate_support: moves the session to SUPPORT and reports escalated', async () => {
    const session = buildSession()
    const ctx = buildCtx()

    const result = await executeAgentActions(
      session as any,
      [{ type: 'escalate_support' }] as AgentAction[],
      ctx
    )

    expect(session.setStatus).toHaveBeenCalledWith('SUPPORT')
    expect(result).toEqual({
      executed: ['escalate_support'],
      suppressReply: false,
      escalated: true,
    })
  })

  it('applies multiple actions in order and returns them all in executed', async () => {
    const session = buildSession()
    const ctx = buildCtx()
    mockFindById.mockResolvedValue({
      id: 'p1',
      name: 'Campanario',
      lat: 2.4,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    })
    mockFindClientById.mockReturnValue({ id: 'c1', name: 'Ana', phone: '+573', photoUrl: '' })

    const result = await executeAgentActions(
      session as any,
      [
        { type: 'set_client_name', name: 'Ana' },
        { type: 'set_place', placeId: 'p1' },
        { type: 'set_comment', text: 'puerta blanca' },
        { type: 'create_service' },
      ] as AgentAction[],
      ctx
    )

    expect(result.executed).toEqual([
      'set_client_name',
      'set_place',
      'set_comment',
      'create_service',
    ])
    expect(result.suppressReply).toBe(true)
  })
})

describe('storePendingPin', () => {
  it('persists the pin coordinates on session.state via setState', async () => {
    const session = buildSession()

    await storePendingPin(session as any, { name: 'pin', lat: 3.1, lng: -76.2 })

    expect(session.setState).toHaveBeenCalledWith({ pending_pin: { lat: 3.1, lng: -76.2 } })
  })
})
