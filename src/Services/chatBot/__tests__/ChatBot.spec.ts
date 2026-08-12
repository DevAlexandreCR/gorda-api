import { randomUUID } from 'crypto'
import ChatBot from '../ChatBot'
import SessionRepository from '../../../Repositories/SessionRepository'
import Session from '../../../Models/Session'
import { SessionInterface } from '../../../Interfaces/SessionInterface'
import { SessionStatuses } from '../../../Types/SessionStatuses'
import { WPClientInterface } from '../../whatsapp/interfaces/WPClientInterface'
import { WpMessageInterface } from '../../whatsapp/interfaces/WpMessageInterface'
import { WpChatInterface } from '../../whatsapp/interfaces/WpChatInterface'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import { WpClients } from '../../whatsapp/constants/WPClients'

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}))

jest.mock('../turns/ConversationTurnQueue', () => ({
  enqueueConversationTurn: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildFakeChat(id = 'chat-1'): WpChatInterface {
  return {
    id,
    archived: false,
    sendMessage: jest.fn().mockResolvedValue(undefined),
    archive: jest.fn().mockResolvedValue(undefined),
    getContact: jest.fn(),
  }
}

function buildFakeWpClient(overrides: Partial<WPClientInterface> = {}): WPClientInterface {
  return {
    serviceName: WpClients.WHATSAPP_WEB_JS,
    sendMessage: jest.fn(),
    sendTypingIndicator: jest.fn(),
    on: jest.fn(),
    getWWebVersion: jest.fn(),
    getState: jest.fn(),
    getChatById: jest.fn().mockResolvedValue(buildFakeChat()),
    logout: jest.fn(),
    initialize: jest.fn(),
    getInfo: jest.fn(),
    ...overrides,
  }
}

function buildInboundMessage(overrides: Partial<WpMessageInterface> = {}): WpMessageInterface {
  return {
    id: 'wamid-raw-1',
    timestamp: 1000,
    type: MessageTypes.TEXT,
    from: 'chat-1',
    isStatus: false,
    body: 'hola',
    location: null,
    interactiveReply: null,
    getChat: jest.fn().mockResolvedValue(buildFakeChat()),
    ...overrides,
  } as unknown as WpMessageInterface
}

function buildSessionRecord(overrides: Partial<SessionInterface> = {}): SessionInterface {
  return {
    id: 'session-record-1',
    status: SessionStatuses.CREATED,
    place: null,
    wp_client_id: 'wp-client-1',
    chat_id: 'chat-1',
    service_id: null,
    created_at: 1000,
    updated_at: null,
    notifications: { greeting: false, assigned: false, arrived: false, completed: false },
    ...overrides,
  }
}

// Mirrors SessionRepository.sessionActiveListener's own construction of the
// Session instance it hands to its listener callback (`new Session(chat_id)`
// + `Object.assign`), so tests that invoke the captured ChatBot listener
// directly pass it the same shape of object the real dispatch would.
function buildSessionRecordAsSession(overrides: Partial<SessionInterface> = {}): Session {
  const record = buildSessionRecord(overrides)
  const session = new Session(record.chat_id)
  Object.assign(session, record)
  return session
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushPromises(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// ChatBot.processMessage: brand-new session registration (bug fix regression)
// ---------------------------------------------------------------------------

describe('ChatBot.processMessage — new session registration', () => {
  let createSpy: jest.SpyInstance
  let addMsgSpy: jest.SpyInstance

  beforeEach(() => {
    ;(randomUUID as jest.Mock).mockReturnValue('session-x')
    createSpy = jest.spyOn(SessionRepository, 'create').mockImplementation(async (session) =>
      buildSessionRecord({
        id: session.id,
        chat_id: session.chat_id,
        wp_client_id: session.wp_client_id,
      })
    )
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockImplementation(async (_sessionId, wpMessage) => ({ created: true, id: wpMessage.id }))
  })

  afterEach(() => {
    createSpy.mockRestore()
    addMsgSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('registers the SAME instance that received the message: getSessionById returns it with the message already stored', async () => {
    const wpClient = buildFakeWpClient()
    const chatBot = new ChatBot(wpClient, 'wp-client-1')
    const message = buildInboundMessage({ id: 'wamid-raw-1', from: 'chat-1', body: 'hola' })

    await chatBot.processMessage(message)

    const session = chatBot.getSessionById('session-x')
    expect(session).toBeDefined()
    expect(session!.messages.has('wamid-raw-1')).toBe(true)
    expect(session!.messages.get('wamid-raw-1')!.msg).toBe('hola')
    // Identity proof: SessionRepository.create was called with this very
    // instance (not a second, empty one the old 'added' listener used to build).
    expect(createSpy).toHaveBeenCalledWith(session)
  })
})

// ---------------------------------------------------------------------------
// ChatBot.processMessage: createSession rejection cleans up the map entry
// ---------------------------------------------------------------------------

describe('ChatBot.processMessage — createSession failure', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('removes the pre-registered map entry and propagates the error when SessionRepository.create rejects', async () => {
    ;(randomUUID as jest.Mock).mockReturnValue('session-fail')
    jest.spyOn(SessionRepository, 'create').mockRejectedValue(new Error('db down'))
    const wpClient = buildFakeWpClient()
    const chatBot = new ChatBot(wpClient, 'wp-client-1')
    const message = buildInboundMessage({ id: 'wamid-raw-2', from: 'chat-2' })

    await expect(chatBot.processMessage(message)).rejects.toThrow('db down')

    expect(chatBot.getSessionById('session-fail')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ChatBot.sync — active-session 'added' listener, cross-source creation
// ---------------------------------------------------------------------------

describe("ChatBot.sync — 'added' listener", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('an added event for a session id not yet in the map registers a new session instance (existing behavior preserved)', async () => {
    const wpClient = buildFakeWpClient()
    const chatBot = new ChatBot(wpClient, 'wp-client-1')
    let capturedListener!: (type: string, session: Session) => void | Promise<void>
    jest.spyOn(SessionRepository, 'getActiveSessions').mockResolvedValue([])
    jest
      .spyOn(SessionRepository, 'sessionActiveListener')
      .mockImplementation((_wpClientId, listener) => {
        capturedListener = listener
      })

    chatBot.sync()
    await flushPromises()

    const sessionY = buildSessionRecordAsSession({ id: 'session-y', chat_id: 'chat-y' })
    await capturedListener('added', sessionY)

    const registered = chatBot.getSessionById('session-y')
    expect(registered).toBeDefined()
    expect(registered!.chat_id).toBe('chat-y')
    expect(wpClient.getChatById).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Race: a brand-new session's own chat lookup (message.getChat()) racing an
// unrelated, concurrent 'added' event's chat lookup (wpClient.getChatById()).
// Both orderings must leave session X correctly holding its message and
// session Y correctly registered — the fix's registration-before-persist in
// findOrCreateSession means the two never contend for the same map key, but
// this pins down that concurrent unrelated Map writes never cross-corrupt.
// ---------------------------------------------------------------------------

describe('ChatBot — concurrent new-session creation vs. an unrelated added event', () => {
  function setupRace() {
    const wpClient = buildFakeWpClient()
    const chatBot = new ChatBot(wpClient, 'wp-client-1')
    let capturedListener!: (type: string, session: Session) => void | Promise<void>
    jest.spyOn(SessionRepository, 'getActiveSessions').mockResolvedValue([])
    jest
      .spyOn(SessionRepository, 'sessionActiveListener')
      .mockImplementation((_wpClientId, listener) => {
        capturedListener = listener
      })
    jest.spyOn(SessionRepository, 'create').mockImplementation(async (session) =>
      buildSessionRecord({
        id: session.id,
        chat_id: session.chat_id,
        wp_client_id: session.wp_client_id,
      })
    )
    jest
      .spyOn(SessionRepository, 'addMsg')
      .mockImplementation(async (_sessionId, wpMessage) => ({ created: true, id: wpMessage.id }))

    return { wpClient, chatBot, getCapturedListener: () => capturedListener }
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('message.getChat() resolves before the concurrent added-listener chat lookup', async () => {
    ;(randomUUID as jest.Mock).mockReturnValue('session-x')
    const { wpClient, chatBot, getCapturedListener } = setupRace()

    chatBot.sync()
    await flushPromises()
    const capturedListener = getCapturedListener()
    expect(capturedListener).toBeDefined()

    const getChatDeferred = createDeferred<WpChatInterface>()
    const message = buildInboundMessage({
      id: 'wamid-raw-x',
      from: 'chat-x',
      getChat: jest.fn().mockReturnValue(getChatDeferred.promise),
    })

    const getChatByIdDeferred = createDeferred<WpChatInterface>()
    ;(wpClient.getChatById as jest.Mock).mockReturnValue(getChatByIdDeferred.promise)

    const processPromise = chatBot.processMessage(message)
    const sessionY = buildSessionRecordAsSession({ id: 'session-y', chat_id: 'chat-y' })
    const listenerPromise = capturedListener('added', sessionY)

    getChatDeferred.resolve(buildFakeChat('chat-x'))
    await flushPromises()
    getChatByIdDeferred.resolve(buildFakeChat('chat-y'))

    await processPromise
    await listenerPromise

    const sessionX = chatBot.getSessionById('session-x')
    expect(sessionX).toBeDefined()
    expect(sessionX!.messages.has('wamid-raw-x')).toBe(true)

    const registeredY = chatBot.getSessionById('session-y')
    expect(registeredY).toBeDefined()
    expect(registeredY!.chat_id).toBe('chat-y')
  })

  it('the concurrent added-listener chat lookup resolves before message.getChat()', async () => {
    ;(randomUUID as jest.Mock).mockReturnValue('session-x')
    const { wpClient, chatBot, getCapturedListener } = setupRace()

    chatBot.sync()
    await flushPromises()
    const capturedListener = getCapturedListener()
    expect(capturedListener).toBeDefined()

    const getChatDeferred = createDeferred<WpChatInterface>()
    const message = buildInboundMessage({
      id: 'wamid-raw-x',
      from: 'chat-x',
      getChat: jest.fn().mockReturnValue(getChatDeferred.promise),
    })

    const getChatByIdDeferred = createDeferred<WpChatInterface>()
    ;(wpClient.getChatById as jest.Mock).mockReturnValue(getChatByIdDeferred.promise)

    const processPromise = chatBot.processMessage(message)
    const sessionY = buildSessionRecordAsSession({ id: 'session-y', chat_id: 'chat-y' })
    const listenerPromise = capturedListener('added', sessionY)

    getChatByIdDeferred.resolve(buildFakeChat('chat-y'))
    await flushPromises()
    getChatDeferred.resolve(buildFakeChat('chat-x'))

    await processPromise
    await listenerPromise

    const sessionX = chatBot.getSessionById('session-x')
    expect(sessionX).toBeDefined()
    expect(sessionX!.messages.has('wamid-raw-x')).toBe(true)

    const registeredY = chatBot.getSessionById('session-y')
    expect(registeredY).toBeDefined()
    expect(registeredY!.chat_id).toBe('chat-y')
  })
})
