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
const mockCreateClient = jest.fn()
jest.mock('../../../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findPlacesWithSuggestions: mockFindPlacesWithSuggestions,
      createClient: mockCreateClient,
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
const mockGreetingNews = jest.fn(() => ({
  id: 'greeting-news',
  name: 'Greeting News',
  description: '',
  message: 'greeting-news',
  enabled: true,
  interactive: null,
}))
jest.mock('../../../Messages', () => ({
  requestingService: (placeName: string) => mockRequestingService(placeName),
  greetingNews: () => mockGreetingNews(),
  newClientAskPlaceName: jest.fn(() => ({
    id: 'ask-place-name',
    name: 'Ask Place Name',
    description: '',
    message: 'ask-place-name',
    enabled: true,
    interactive: null,
  })),
  newClientAskForComment: jest.fn(() => ({
    id: 'ask-for-comment',
    name: 'Ask For Comment',
    description: '',
    message: 'ask-for-comment',
    enabled: true,
    interactive: null,
  })),
  getSingleMessage: jest.fn(() => ({
    id: 'generic',
    name: 'Generic',
    description: '',
    message: 'generic',
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

import { AskingForName } from '../AskingForName'
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
    messages: new Map<string, WpMessage>(),
    chat: {
      getContact: jest
        .fn()
        .mockResolvedValue({ pushname: '', phone: '573001234567', photoUrl: '' }),
    },
    setStatus: jest.fn().mockResolvedValue(undefined),
    setPlace: jest.fn().mockResolvedValue(undefined),
    setPlaceOptions: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
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

describe('AskingForName.processMessage - intent dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateClient.mockResolvedValue({ id: 'client-1', name: 'Juan', phone: '573001234567' })
  })

  it('name and place captured in one turn: creates the client and runs the place flow immediately, without re-asking', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_NAME,
      name: 'Juan',
      place: 'Campanario',
      message: {
        id: 'ai-1',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_PLACE,
    })
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: strongPlace,
      suggestions: [],
      hasStrongCandidate: true,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('Soy Juan, estoy en Campanario'))

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockFindPlacesWithSuggestions).toHaveBeenCalledWith('Campanario')
    expect(session.setPlace).toHaveBeenCalledWith(strongPlace)
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.ASKING_FOR_COMMENT)

    // Never re-asks for the location: no greeting/ask-place-name message sent.
    expect(mockGreetingNews).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(mockRequestingService).toHaveBeenCalledWith(strongPlace.name)
  })

  it('name only: creates the client and asks for the location as before (no session place yet)', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_NAME,
      name: 'Juan',
      place: undefined,
      message: {
        id: 'ai-2',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_PLACE,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('Me llamo Juan'))

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.ASKING_FOR_PLACE)
    expect(mockGreetingNews).toHaveBeenCalledTimes(1)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('SUPPORT takes precedence over an extracted name/place: moves to SUPPORT without creating a client', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.SUPPORT,
      name: 'Juan',
      place: 'Campanario',
      message: {
        id: 'ai-support',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Cuesta entre $6.000 y $8.000',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_NAME,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('¿cuánto cuesta desde Campanario?'))

    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).toHaveBeenCalledWith(SessionStatuses.SUPPORT)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('REFUSAL re-asks within the same state without creating a client', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.REFUSAL,
      place: undefined,
      message: {
        id: 'ai-refusal',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Entiendo, ¿me confirmas tu nombre?',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_NAME,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('no quiero decirte'))

    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('AMBIGUOUS re-asks within the same state without creating a client', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.AMBIGUOUS,
      place: undefined,
      message: {
        id: 'ai-ambiguous',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: '¿Puedes darme tu nombre?',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_NAME,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('no sé'))

    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('falls back to a re-ask when intent is PROVIDE_PLACE without a name (out of the acceptance matrix here)', async () => {
    mockHandleMessage.mockResolvedValue({
      intent: Intent.PROVIDE_PLACE,
      place: 'Campanario',
      message: {
        id: 'ai-place-only',
        created_at: Date.now(),
        type: MessageTypes.TEXT,
        body: 'Necesito tu nombre para continuar',
        fromMe: true,
        interactive: null,
        interactiveReply: null,
      },
      sessionStatus: SessionStatuses.ASKING_FOR_NAME,
    })

    const session = buildMockSession()
    const strategy = new AskingForName(session as any)
    await strategy.processMessage(buildTextMessage('estoy en Campanario'))

    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockFindPlacesWithSuggestions).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
  })
})
