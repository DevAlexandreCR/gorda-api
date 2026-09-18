import fs from 'fs'
import path from 'path'

jest.mock('../../../../Models/Session', () => ({
  __esModule: true,
  default: {
    STATUS_BOOKING: 'BOOKING',
    STATUS_REQUESTING_SERVICE: 'REQUESTING_SERVICE',
    STATUS_SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
    STATUS_COMPLETED: 'COMPLETED',
  },
}))

// Messages.getSingleMessage/requestingService normally resolve through
// Store.findMessageById; stubbed here (same pattern as
// AgentExecutor.spec.ts/DeterministicHandlers.spec.ts) so these tests assert
// only on which catalog id (or place name) was requested.
jest.mock('../../Messages', () => ({
  getSingleMessage: jest.fn((id: string) => ({
    id,
    name: id,
    description: '',
    message: id,
    enabled: true,
    interactive: null,
  })),
  requestingService: jest.fn((placeName: string) => ({
    id: 'REQUESTING_SERVICE',
    name: 'REQUESTING_SERVICE',
    description: '',
    message: `requesting:${placeName}`,
    enabled: true,
    interactive: null,
  })),
}))

const mockFindClientById = jest.fn()
const mockCreateClient = jest.fn()
const mockFindCityById = jest.fn()
jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findClientById: mockFindClientById,
      createClient: mockCreateClient,
      findCityById: mockFindCityById,
    })),
  },
}))

const mockBookService = jest.fn()
jest.mock('../../ServiceBooking', () => ({
  bookService: (...args: unknown[]) => mockBookService(...args),
}))

const mockSendGatedMessage = jest.fn()
jest.mock('../../TurnSupport', () => ({
  sendGatedMessage: (...args: unknown[]) => mockSendGatedMessage(...args),
}))

const mockHandleRequestingServiceMessage = jest.fn()
const mockHandleInTripMessage = jest.fn()
jest.mock('../../deterministic/DeterministicHandlers', () => {
  const actual = jest.requireActual('../../deterministic/DeterministicHandlers')
  return {
    ...actual,
    handleRequestingServiceMessage: (...args: unknown[]) =>
      mockHandleRequestingServiceMessage(...args),
    handleInTripMessage: (...args: unknown[]) => mockHandleInTripMessage(...args),
  }
})

import { runLocationAssistantTurn } from '../LocationAssistantFlow'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'
import { SessionState } from '../../../../Types/SessionState'

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

function locationMessage(overrides: Partial<WpMessage> = {}): WpMessage {
  return buildMessage({
    type: MessageTypes.LOCATION,
    location: { name: '', lat: 2.44, lng: -76.6 },
    ...overrides,
  })
}

// setPlace/setState/setStatus mutate the fixture in place, mirroring the real
// Session class (which updates the field synchronously before persisting) —
// LocationAssistantFlow relies on reading session.place/session.state right
// back within the same turn (e.g. a named pin resolving the place, then
// immediately checking it to decide whether to ask for a comment).
function buildSession(overrides: Record<string, unknown> = {}) {
  const session: any = {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    status: 'BOOKING',
    place: null as PlaceInterface | null,
    state: {
      comment: null,
      pending_candidates: [],
      pending_pin: null,
      awaiting: null,
    } as SessionState,
    chat: {
      getContact: jest.fn().mockResolvedValue({ pushname: '', number: '573', id: 'c1' }),
    },
    ...overrides,
  }
  session.setPlace = jest.fn((place: PlaceInterface) => {
    session.place = place
    return Promise.resolve()
  })
  session.setState = jest.fn((patch: Partial<SessionState>) => {
    session.state = { ...session.state, ...patch }
    return Promise.resolve()
  })
  session.setStatus = jest.fn((status: string) => {
    session.status = status
    return Promise.resolve()
  })
  return session
}

describe('LocationAssistantFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindCityById.mockReturnValue({ id: 'popayan', name: 'Popayán' })
  })

  it('never imports the agent module (no model calls on this flow)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../LocationAssistantFlow.ts'), 'utf8')
    expect(source).not.toMatch(/chatBot\/agent/)
    expect(source).not.toMatch(/OpenAIResponsesClient/)
  })

  describe('BOOKING: profile-name shortcut', () => {
    it('creates the client from the pushname and requests the service in one turn for a named pin', async () => {
      mockFindClientById.mockReturnValue(undefined)
      const session = buildSession({
        chat: {
          getContact: jest.fn().mockResolvedValue({ pushname: 'Carlos', number: '573', id: 'c1' }),
        },
      })

      await runLocationAssistantTurn(
        session as any,
        locationMessage({ location: { name: 'Portería Sur', lat: 2.44, lng: -76.6 } })
      )

      expect(mockCreateClient).toHaveBeenCalledTimes(1)
      expect(mockCreateClient.mock.calls[0][0].pushname).toBe('Carlos')

      expect(session.setPlace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Portería Sur', lat: 2.44, lng: -76.6, cityId: 'popayan' })
      )

      expect(session.setState).toHaveBeenCalledWith({ awaiting: 'comment' })
      expect(mockSendGatedMessage).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ message: 'requesting:Portería Sur' })
      )
    })
  })

  describe('BOOKING: no profile name', () => {
    it('asks for the name, then creates the client from the next text message', async () => {
      mockFindClientById.mockReturnValueOnce(undefined) // location turn: unknown client
      const session = buildSession()

      await runLocationAssistantTurn(
        session as any,
        locationMessage({ location: { name: 'Portería Sur', lat: 2.44, lng: -76.6 } })
      )

      expect(session.setState).toHaveBeenCalledWith({ awaiting: 'name' })
      expect(mockSendGatedMessage).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ id: 'ASK_FOR_NAME' })
      )
      expect(mockCreateClient).not.toHaveBeenCalled()

      // The named pin already resolved session.place during the location turn
      // (the mutating setPlace mock reflects that); only the client is still missing.
      expect(session.place).toEqual(expect.objectContaining({ name: 'Portería Sur' }))
      mockFindClientById.mockReturnValue({ id: 'c1' } as ClientInterface) // client now exists after creation

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'juan perez' }))

      expect(mockCreateClient).toHaveBeenCalledTimes(1)
      expect(mockCreateClient.mock.calls[0][0].pushname).toBe('Juan Perez')
      expect(session.setState).toHaveBeenCalledWith({ awaiting: 'comment' })
    })
  })

  describe('BOOKING: unnamed pin', () => {
    it('asks for a reference name, then sets the place from the reply', async () => {
      mockFindClientById.mockReturnValue({ id: 'c1' } as ClientInterface) // already a client
      const session = buildSession()

      await runLocationAssistantTurn(session as any, locationMessage())

      expect(session.setState).toHaveBeenCalledWith({
        pending_pin: { lat: 2.44, lng: -76.6 },
      })
      expect(session.setState).toHaveBeenCalledWith({ awaiting: 'reference' })
      expect(mockSendGatedMessage).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ id: 'ASK_FOR_LOCATION_NAME' })
      )
      expect(session.setPlace).not.toHaveBeenCalled()
      expect(session.state.awaiting).toBe('reference')

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'portería norte' }))

      expect(session.setPlace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'portería norte',
          lat: 2.44,
          lng: -76.6,
          cityId: 'popayan',
        })
      )
      expect(session.setState).toHaveBeenCalledWith({ pending_pin: null })
    })

    it('re-sends NO_LOCATION_NAME_FOUND for unusable text', async () => {
      const session = buildSession({
        state: {
          comment: null,
          pending_candidates: [],
          pending_pin: { lat: 1, lng: 2 },
          awaiting: 'reference',
        },
      })

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'ok' }))

      expect(mockSendGatedMessage).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ id: 'NO_LOCATION_NAME_FOUND' })
      )
      expect(session.setPlace).not.toHaveBeenCalled()
    })
  })

  describe('BOOKING: comment then service creation', () => {
    it('creates the service via bookService and moves to REQUESTING_SERVICE', async () => {
      mockFindClientById.mockReturnValue({ id: 'c1', name: 'Juan' } as ClientInterface)
      const place: PlaceInterface = {
        id: '',
        name: 'Portería Sur',
        lat: 2.44,
        lng: -76.6,
        location: null,
        cityId: 'popayan',
      }
      const session = buildSession({
        place,
        state: { comment: null, pending_candidates: [], pending_pin: null, awaiting: 'comment' },
      })

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'casa esquinera' }))

      expect(mockBookService).toHaveBeenCalledTimes(1)
      const [passedSession, params] = mockBookService.mock.calls[0]
      expect(passedSession).toBe(session)
      expect(params.place).toBe(place)
      expect(params.client).toEqual({ id: 'c1', name: 'Juan' })
      expect(params.comment).toBe('casa esquinera')
    })

    it('ends the session on "cancelar" without creating a service', async () => {
      mockFindClientById.mockReturnValue({ id: 'c1', name: 'Juan' } as ClientInterface)
      const session = buildSession({
        place: {
          id: '',
          name: 'Portería Sur',
          lat: 2.44,
          lng: -76.6,
          location: null,
          cityId: 'popayan',
        },
        state: { comment: null, pending_candidates: [], pending_pin: null, awaiting: 'comment' },
      })

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'cancelar' }))

      expect(mockBookService).not.toHaveBeenCalled()
      expect(session.setStatus).toHaveBeenCalledWith('COMPLETED')
    })
  })

  describe('BOOKING: non-covered pin', () => {
    it('sends NON_COVERED_AREA and completes the session', async () => {
      mockFindCityById.mockReturnValue(undefined)
      const session = buildSession()

      await runLocationAssistantTurn(session as any, locationMessage())

      expect(mockSendGatedMessage).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ id: 'NON_COVERED_AREA' })
      )
      expect(session.setStatus).toHaveBeenCalledWith('COMPLETED')
      expect(session.setState).not.toHaveBeenCalled()
      expect(mockCreateClient).not.toHaveBeenCalled()
    })
  })

  describe('BOOKING: defensive no-op', () => {
    it('does nothing for a bare text message with nothing pending', async () => {
      const session = buildSession()

      await runLocationAssistantTurn(session as any, buildMessage({ msg: 'hola' }))

      expect(mockSendGatedMessage).not.toHaveBeenCalled()
      expect(session.setState).not.toHaveBeenCalled()
      expect(session.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('post-creation delegation', () => {
    it('delegates REQUESTING_SERVICE turns to handleRequestingServiceMessage', async () => {
      const session = buildSession({ status: 'REQUESTING_SERVICE' })
      const message = buildMessage({ msg: 'cancelar' })

      await runLocationAssistantTurn(session as any, message)

      expect(mockHandleRequestingServiceMessage).toHaveBeenCalledTimes(1)
      expect(mockHandleRequestingServiceMessage.mock.calls[0][0]).toBe(session)
      expect(mockHandleRequestingServiceMessage.mock.calls[0][1]).toBe(message)
    })

    it('delegates SERVICE_IN_PROGRESS turns to handleInTripMessage', async () => {
      const session = buildSession({ status: 'SERVICE_IN_PROGRESS' })
      const message = buildMessage({ msg: 'cancelar' })

      await runLocationAssistantTurn(session as any, message)

      expect(mockHandleInTripMessage).toHaveBeenCalledWith(session, message)
    })
  })
})
