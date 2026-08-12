// Mock Session before any module that triggers the circular Session -> ResponseContext -> subclasses cycle
jest.mock('../../../../../Models/Session', () => {
  const SessionStatuses = {
    AGREEMENT: 'agreement',
    CREATED: 'created',
    ASKING_FOR_PLACE: 'asking_for_place',
    CHOOSING_PLACE: 'choosing_place',
    ASKING_FOR_COMMENT: 'asking_for_comment',
    REQUESTING_SERVICE: 'requesting_service',
    SERVICE_IN_PROGRESS: 'service_in_progress',
    COMPLETED: 'completed',
    ASKING_FOR_NAME: 'asking_for_name',
    SUPPORT: 'support',
  }
  class MockSession {
    static STATUS_AGREEMENT = SessionStatuses.AGREEMENT
    static STATUS_CREATED = SessionStatuses.CREATED
    static STATUS_ASKING_FOR_PLACE = SessionStatuses.ASKING_FOR_PLACE
    static STATUS_CHOOSING_PLACE = SessionStatuses.CHOOSING_PLACE
    static STATUS_ASKING_FOR_COMMENT = SessionStatuses.ASKING_FOR_COMMENT
    static STATUS_REQUESTING_SERVICE = SessionStatuses.REQUESTING_SERVICE
    static STATUS_SERVICE_IN_PROGRESS = SessionStatuses.SERVICE_IN_PROGRESS
    static STATUS_COMPLETED = SessionStatuses.COMPLETED
    static STATUS_ASKING_FOR_NAME = SessionStatuses.ASKING_FOR_NAME
    static STATUS_SUPPORT = SessionStatuses.SUPPORT
  }
  return { default: MockSession }
})

jest.mock('../../../../../Repositories/ServiceRepository', () => ({
  create: jest.fn(),
}))

jest.mock('../../../../../Repositories/SessionRepository', () => ({
  __esModule: true,
  default: {
    addMsg: jest.fn().mockResolvedValue({ created: true, id: 'mock-outbound-id' }),
  },
}))

const mockFindPlacesWithSuggestions = jest.fn()
jest.mock('../../../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findPlacesWithSuggestions: mockFindPlacesWithSuggestions,
      wpClients: { 'wp-client-1': { service: 'wa-web' } },
      findCountryByCity: jest.fn().mockReturnValue('colombia'),
    })),
  },
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

jest.mock('../../../../../Container/Container', () => ({
  __esModule: true,
  default: {
    getPlaceRepository: jest.fn(),
    getServiceHistoryRepository: jest.fn(),
  },
}))

const mockHandleMessage = jest.fn()
jest.mock('../../../ai/MessageHandler', () => ({
  MessageHandler: jest.fn().mockImplementation(() => ({
    handleMessage: mockHandleMessage,
  })),
}))

const mockRequestingService = jest.fn((placeName: string) => ({
  id: 'requesting-service',
  name: 'Requesting Service',
  description: '',
  message: `Buscando en ${placeName}`,
  enabled: true,
  interactive: null,
}))
jest.mock('../../../Messages', () => ({
  requestingService: (placeName: string) => mockRequestingService(placeName),
  getSingleMessage: jest.fn(() => ({
    id: 'generic',
    name: 'Generic',
    description: '',
    message: 'generic',
    enabled: true,
    interactive: null,
  })),
  greeting: jest.fn(() => ({
    id: 'greeting',
    name: 'Greeting',
    description: '',
    message: 'greeting',
    enabled: true,
    interactive: null,
  })),
}))

const mockCreateConfirmationMessage = jest.fn(() => ({
  id: 'confirmation',
  name: 'Confirmation',
  description: '',
  message: 'confirmation',
  enabled: true,
  interactive: null,
}))
const mockCreateSuggestionMessage = jest.fn(() => ({
  id: 'suggestion',
  name: 'Suggestion',
  description: '',
  message: 'suggestion',
  enabled: true,
  interactive: null,
}))
jest.mock('../../../PlaceSuggestionHelper', () => ({
  PlaceSuggestionHelper: {
    createConfirmationMessage: mockCreateConfirmationMessage,
    createSuggestionMessage: mockCreateSuggestionMessage,
  },
}))

import { Created } from '../Created'
import Session from '../../../../../Models/Session'
import { WpMessage } from '../../../../../Types/WpMessage'
import { MessageTypes } from '../../../../whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../../../../Types/SessionStatuses'
import { PlaceInterface } from '../../../../../Interfaces/PlaceInterface'
import { Intent } from '../../../../../Types/Intent'

function buildMockSession() {
  return {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    wp_client_id: 'wp-client-1',
    place: null as PlaceInterface | null,
    notifications: { greeting: true },
    messages: new Map<string, WpMessage>(),
    setStatus: jest.fn().mockResolvedValue(undefined),
    setPlace: jest.fn().mockResolvedValue(undefined),
    setPlaceOptions: jest.fn().mockResolvedValue(undefined),
    setNotification: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
  }
}

function buildTextMessage(msg: string): WpMessage {
  return {
    created_at: Date.now(),
    id: 'msg-1',
    type: MessageTypes.TEXT,
    msg,
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

const strongPlace: PlaceInterface = {
  id: 'place-strong',
  name: 'Centro Comercial Unicentro',
  lat: 2.44,
  lng: -76.6,
  location: null,
  cityId: 'popayan',
}

const candidatePlace: PlaceInterface = {
  id: 'place-candidate',
  name: 'Estación Norte',
  lat: 2.45,
  lng: -76.61,
  location: null,
  cityId: 'popayan',
}

const suggestionOne = { id: 'sugg-1', name: 'Estación Sur' }
const suggestionTwo = { id: 'sugg-2', name: 'Mall Libertadores' }

describe('Created.validateKey - place resolution tiers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_PLACE,
      place: 'unicentro',
      message: {
        id: 'ai-1',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })
  })

  it('auto-accepts a strong candidate: no confirmation, place set, status ASKING_FOR_COMMENT', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: strongPlace,
      suggestions: [],
      hasStrongCandidate: true,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('unicentro'))

    expect(mockRequestingService).toHaveBeenCalledWith(strongPlace.name)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setPlace).toHaveBeenCalledWith(strongPlace)
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.ASKING_FOR_COMMENT)

    expect(mockCreateConfirmationMessage).not.toHaveBeenCalled()
    expect(mockCreateSuggestionMessage).not.toHaveBeenCalled()
    expect(session.setPlaceOptions).not.toHaveBeenCalled()
  })

  it('asks for confirmation when a candidate exists but is not a strong match', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: candidatePlace,
      suggestions: [suggestionOne],
      hasStrongCandidate: false,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('estación'))

    expect(mockCreateConfirmationMessage).toHaveBeenCalledWith(candidatePlace.name, 'wa-web', {
      id: session.id,
    })
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.CHOOSING_PLACE)
    expect(session.setPlaceOptions).toHaveBeenCalledWith([
      { option: 0, placeId: `confirm:${candidatePlace.id}` },
      { option: 1, placeId: suggestionOne.id },
    ])

    expect(mockRequestingService).not.toHaveBeenCalled()
    expect(session.setPlace).not.toHaveBeenCalled()
    expect(mockCreateSuggestionMessage).not.toHaveBeenCalled()
  })

  it('sends a numbered suggestion list when there is no candidate, only suggestions', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: null,
      suggestions: [suggestionOne, suggestionTwo],
      hasStrongCandidate: false,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('parque libertad'))

    expect(mockCreateSuggestionMessage).toHaveBeenCalledWith(
      [
        { option: 1, placeId: suggestionOne.id, placeName: suggestionOne.name },
        { option: 2, placeId: suggestionTwo.id, placeName: suggestionTwo.name },
      ],
      'unicentro',
      'wa-web',
      { id: session.id }
    )
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.CHOOSING_PLACE)
    expect(session.setPlaceOptions).toHaveBeenCalledWith([
      { option: 1, placeId: suggestionOne.id },
      { option: 2, placeId: suggestionTwo.id },
    ])

    expect(mockRequestingService).not.toHaveBeenCalled()
    expect(mockCreateConfirmationMessage).not.toHaveBeenCalled()
    expect(session.setPlace).not.toHaveBeenCalled()
  })
})

describe('Created.validateKey - intent dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends the real CREATED session status to the AI (not a hardcoded ASKING_FOR_PLACE)', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_PLACE,
      place: 'unicentro',
      message: {
        id: 'ai-1',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: strongPlace,
      suggestions: [],
      hasStrongCandidate: true,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('unicentro'))

    expect(mockHandleMessage).toHaveBeenCalledWith(
      'unicentro',
      SessionStatuses.CREATED,
      expect.anything()
    )
  })

  it('SUPPORT takes precedence over an extracted place: moves to SUPPORT and skips place search', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.SUPPORT,
      place: 'La Esmeralda',
      message: {
        id: 'ai-support',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Cuesta entre $6.000 y $8.000',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('¿cuánto cuesta desde La Esmeralda?'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.SUPPORT)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setPlace).not.toHaveBeenCalled()
  })

  it('discards an extracted name (client already exists) and still runs the place search when intent is PROVIDE_PLACE', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_PLACE,
      name: 'Juan',
      place: 'unicentro',
      message: {
        id: 'ai-name-and-place',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: strongPlace,
      suggestions: [],
      hasStrongCandidate: true,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('Soy Juan, estoy en unicentro'))

    expect(mockFindPlacesWithSuggestions).toHaveBeenCalledWith('unicentro')
    expect(session.setPlace).toHaveBeenCalledWith(strongPlace)
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.ASKING_FOR_COMMENT)
  })

  it('REFUSAL re-asks with the AI clarification message when the greeting was already sent', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.REFUSAL,
      place: undefined,
      message: {
        id: 'ai-refusal',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Entiendo, ¿me confirmas el barrio o dirección?',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('no quiero decirte'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('AMBIGUOUS re-asks with the AI clarification message when the greeting was already sent', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.AMBIGUOUS,
      place: undefined,
      message: {
        id: 'ai-ambiguous',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '¿Puedes darme el nombre del barrio o una dirección más exacta?',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('por ahí cerca'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('PROVIDE_NAME is out of the acceptance matrix for CREATED and falls back to the re-ask', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_NAME,
      name: 'Juan',
      place: undefined,
      message: {
        id: 'ai-name-only',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Necesito el barrio o dirección para continuar',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })

    const session = buildMockSession()
    const strategy = new Created(session as any)
    await strategy.validateKey(buildTextMessage('me llamo Juan'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('sends the first-contact greeting instead of the AI message when the greeting has not been sent yet', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.AMBIGUOUS,
      place: undefined,
      message: {
        id: 'ai-ambiguous-2',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '¿Puedes darme el nombre del barrio o una dirección más exacta?',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.CREATED,
    })

    const session = buildMockSession()
    session.notifications.greeting = false
    const strategy = new Created(session as any)
    ;(strategy as any).currentClient = { id: 'client-1', name: 'Ana', phone: '', photoUrl: '' }
    await strategy.validateKey(buildTextMessage('hola'))

    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).toHaveBeenCalledWith(Session.STATUS_ASKING_FOR_PLACE)
    expect(session.setNotification).toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })
})
