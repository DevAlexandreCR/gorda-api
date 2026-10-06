// Store's private constructor touches Firebase/Redis-backed repositories; stub it so the
// module can be loaded and `new WhatsAppClient()` constructed without a live backend.
jest.mock('../../store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      // getChats is called eagerly by OfficialClient's constructor (initClient idempotency
      // tests, spec: wp-inbound-single-processing, construct real OfficialClient instances).
      getChats: jest.fn(),
      findClientById: jest.fn(),
      getChatById: jest.fn(),
      // Consumed by Messages.serviceAssigned via getStore().findMessageById in the
      // serviceChanged describe block below (spec: wp-notification-single-delivery).
      // Enabled by default so mustSend evaluates true unless a test says otherwise.
      findMessageById: jest.fn().mockReturnValue({
        id: 'service_assigned',
        name: 'service_assigned',
        message: 'Tu conductor llega en un movil placa [[PLATE]], color [[COLOR]]',
        enabled: true,
        description: '',
        interactive: null,
      }),
    }),
  },
}))

// DatabaseService is instantiated eagerly at module load (Admin.getInstance()); mock it so
// importing WhatsAppClient (and its Repository dependencies) never touches Firebase Admin.
jest.mock('../../firebase/Database', () => ({
  __esModule: true,
  default: {
    dbServices: jest.fn(),
    dbWpNotifications: jest.fn(),
  },
}))

// bullmq is mocked the same way as ConversationTurnQueue.spec.ts / QueueService.spec.ts so
// onReady's real registerConversationTurnQueue call (task 3.7) exercises the real
// QueueService singleton without opening a Redis connection.
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({})),
}))

// ChatBot.sync() would otherwise hit SessionRepository/Postgres; onReady's registration
// ordering test only cares that ChatBot exists before the worker is registered.
jest.mock('../../chatBot/ChatBot', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    sync: jest.fn(),
  })),
}))

// WpNotificationRepository/ServiceRepository register real Firebase RTDB listeners in
// onReady; stub them so onReady can run end-to-end in this test file.
jest.mock('../../../Repositories/WpNotificationRepository', () => ({
  __esModule: true,
  default: {
    offNotifications: jest.fn(),
    onServiceAssigned: jest.fn(),
    onDriverArrived: jest.fn(),
    onNewService: jest.fn(),
    onServiceCanceled: jest.fn(),
    onServiceTerminated: jest.fn(),
  },
}))

jest.mock('../../../Repositories/ServiceRepository', () => ({
  __esModule: true,
  default: {
    // Returns a fresh unsubscribe spy per call (design D7), so tests can assert onReady
    // calls the previous registration's unsubscribe before registering a new one.
    onServiceChanged: jest.fn(() => jest.fn()),
  },
}))

// sendTypingIndicator (real OfficialClient method, exercised by the combined-failure-chain
// test below) hits the network via axios; automock it so that fire-and-forget call never
// makes a real request.
jest.mock('axios')

// The combined-failure-chain test (task 2.4) exercises the real Session.addMsg ->
// SessionRepository.addMsg path (design D3) to prove cross-session dedup collapses a
// duplicated inbound message to one enqueued turn. Only the Sequelize model layer is
// mocked, mirroring SessionRepository.spec.ts's convention.
jest.mock('../../../Models/ChatSessionRecord', () => ({
  findByPk: jest.fn(),
}))

jest.mock('../../../Models/WhatsappMessageRecord', () => ({
  findOrCreate: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
}))

// The task 4.4 tests below drive a non-Official line, which makes onMessageReceived call
// shouldProcessInboundMessage -> InboundMessageDedupCache.evaluate ->
// ProcessedInboundMessageRepository.exists, a real Sequelize model call otherwise unmocked
// in this file (every prior test here uses the Official service, which skips this branch
// entirely). Mock it the same way as the other Sequelize models above so dedup resolves
// to "process" without touching a real database.
jest.mock('../../../Models/ProcessedInboundMessage', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  },
}))

// Task 4.4 (spec: wp-interactive-fallback): the promotion tests below drive a
// non-Official line, which makes onMessageReceived's persistence branch call
// MessageRepository.findLatestOutbound (to read the offered options) and
// MessageRepository.addMessage (inbound persistence). Neither needs the real
// Sequelize-backed implementation here; each test configures findLatestOutbound
// directly.
jest.mock('../../../Repositories/MessageRepository', () => ({
  __esModule: true,
  default: {
    findLatestOutbound: jest.fn(),
    addMessage: jest.fn().mockResolvedValue(undefined),
  },
}))

import * as Sentry from '@sentry/node'
import { Worker } from 'bullmq'
import { DataSnapshot } from 'firebase-admin/lib/database'
import { WhatsAppClient } from '../WhatsAppClient'
import { WpClient } from '../../../Interfaces/WpClient'
import { WpClients } from '../constants/WPClients'
import { WpEvents } from '../constants/WpEvents'
import { MessageTypes } from '../constants/MessageTypes'
import { WpMessageInterface } from '../interfaces/WpMessageInterface'
import { WPClientInterface } from '../interfaces/WPClientInterface'
import { OfficialClient } from '../services/Official/OfficialClient'
import QueueService from '../../queue/QueueService'
import { getConversationTurnQueueName } from '../../chatBot/turns/ConversationTurnQueue'
import Session from '../../../Models/Session'
import ChatSessionRecord from '../../../Models/ChatSessionRecord'
import WhatsappMessageRecord from '../../../Models/WhatsappMessageRecord'
import MessageRepository from '../../../Repositories/MessageRepository'
import WpNotificationRepository from '../../../Repositories/WpNotificationRepository'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import SessionRepository from '../../../Repositories/SessionRepository'
import { Store } from '../../store/Store'
import { Interactive } from '../services/Official/Constants/Interactive'

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

function buildWpClient(overrides: Partial<WpClient> = {}): WpClient {
  return {
    id: 'wp-client-1',
    alias: 'Test Client',
    wpNotifications: false,
    full: false,
    chatBot: true,
    assistant: false,
    agentInTrip: false,
    service: WpClients.OFFICIAL,
    ...overrides,
  }
}

function buildMsg(overrides: Partial<WpMessageInterface> = {}): WpMessageInterface {
  return {
    id: 'wamid.HBgMOTI=',
    timestamp: Math.floor(Date.now() / 1000),
    type: MessageTypes.TEXT,
    from: '573001234567@c.us',
    isStatus: false,
    body: 'Hola',
    location: null as any,
    interactiveReply: null,
    getChat: jest.fn(),
    ...overrides,
  }
}

// A text message on a non-Official line goes through onMessageReceived's persistence
// branch (task 4.4), which fetches the chat/contact before storing the inbound row.
function buildBaileysMsg(overrides: Partial<WpMessageInterface> = {}): WpMessageInterface {
  return buildMsg({
    getChat: jest.fn().mockResolvedValue({ getContact: jest.fn().mockResolvedValue(null) }),
    ...overrides,
  })
}

function buildButtonOffer(): Interactive {
  return {
    type: 'button',
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'CANCEL', title: 'Cancelar' } },
        { type: 'reply', reply: { id: 'INSIST', title: 'Insistir' } },
      ],
    },
  }
}

// Builds a WhatsAppClient wired to a fake WPClientInterface transport and a fake ChatBot,
// bypassing initClient()/onReady() (which pull in the real transport + Firebase listeners).
// This exercises onMessageReceived's actual wiring for the typing-indicator call site.
function buildClient(
  wpClientOverrides: Partial<WpClient> = {},
  chatBotOverrides: { findSessionByChatId?: jest.Mock; processMessage?: jest.Mock } = {}
) {
  const wpClient = buildWpClient(wpClientOverrides)
  const whatsAppClient = new WhatsAppClient(wpClient)

  const client: jest.Mocked<WPClientInterface> = {
    serviceName: wpClient.service,
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
    getWWebVersion: jest.fn(),
    getState: jest.fn(),
    getChatById: jest.fn(),
    logout: jest.fn(),
    initialize: jest.fn(),
    getInfo: jest.fn(),
  }
  ;(whatsAppClient as any).client = client

  const chatBot = {
    findSessionByChatId:
      chatBotOverrides.findSessionByChatId ?? jest.fn().mockReturnValue(undefined),
    processMessage: chatBotOverrides.processMessage ?? jest.fn().mockResolvedValue(undefined),
  }
  ;(whatsAppClient as any).chatBot = chatBot

  return { whatsAppClient, client, chatBot }
}

describe('WhatsAppClient.onMessageReceived typing indicator wiring (spec: chatbot-typing-indicator)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fires the typing indicator with the inbound message id for a processable text message, then still processes it', async () => {
    const { whatsAppClient, client, chatBot } = buildClient()
    const msg = buildMsg({ type: MessageTypes.TEXT, from: '573001234567@c.us', id: 'wamid.text-1' })

    await whatsAppClient.onMessageReceived(msg)

    expect(client.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(client.sendTypingIndicator).toHaveBeenCalledWith('573001234567@c.us', 'wamid.text-1')
    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
  })

  it('does NOT fire the typing indicator for a location message, but still processes it normally', async () => {
    const { whatsAppClient, client, chatBot } = buildClient()
    const msg = buildMsg({ type: MessageTypes.LOCATION, body: '' })

    await whatsAppClient.onMessageReceived(msg)

    expect(client.sendTypingIndicator).not.toHaveBeenCalled()
    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
  })

  it('does NOT fire the typing indicator for an interactive button reply, but still processes it normally', async () => {
    // Interactive replies are only processable mid-conversation, i.e. when a session already exists.
    const findSessionByChatId = jest.fn().mockReturnValue({ chat_id: '573001234567@c.us' })
    const { whatsAppClient, client, chatBot } = buildClient({}, { findSessionByChatId })
    const msg = buildMsg({ type: MessageTypes.INTERACTIVE })

    await whatsAppClient.onMessageReceived(msg)

    expect(client.sendTypingIndicator).not.toHaveBeenCalled()
    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
  })

  it('never lets a rejected sendTypingIndicator propagate, and still processes the message (fire-and-forget)', async () => {
    const { whatsAppClient, client, chatBot } = buildClient()
    const msg = buildMsg({ type: MessageTypes.TEXT })
    const typingError = new Error('WAPI rejected the typing payload')
    client.sendTypingIndicator.mockRejectedValue(typingError)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(whatsAppClient.onMessageReceived(msg)).resolves.toBeUndefined()
    await flushMicrotasks()

    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
    expect(warnSpy).toHaveBeenCalledWith(
      'sendTypingIndicator error',
      'Test Client',
      typingError.message
    )

    warnSpy.mockRestore()
  })
})

describe('WhatsAppClient.isProcessableMsg gating on a wpNotifications-only line (spec: chatbot-session-state, task 6.2)', () => {
  it('an inbound text message on a line with only wpNotifications enabled is not processed and no session is created', async () => {
    const { whatsAppClient, chatBot } = buildClient({
      wpNotifications: true,
      chatBot: false,
      assistant: false,
    })
    const msg = buildMsg({ type: MessageTypes.TEXT, body: 'Hola' })

    await whatsAppClient.onMessageReceived(msg)

    // isProcessableMsg first checks for an existing session; none exists here, and with
    // both chatBot and assistant disabled it falls through to false, so the message never
    // reaches ChatBot.processMessage (which is what would create a session).
    expect(chatBot.findSessionByChatId).toHaveBeenCalledWith(msg.from)
    expect(chatBot.processMessage).not.toHaveBeenCalled()
  })
})

// The courtesy filter (MessageHelper.isCourtesyMessage) must only gate the deterministic
// `assistant` line (LocationAssistantFlow), never the agent-driven `chatBot` line, which
// judges acknowledgment vs. new intent itself. A session is stubbed as already existing so
// isMessageTypeSupported passes TEXT through uniformly on both line kinds, isolating the
// courtesy branch under test from the rest of isProcessableMsg's fallback logic.
describe('WhatsAppClient.isProcessableMsg courtesy-filter scoping to the assistant line only', () => {
  const findSessionByChatId = jest.fn().mockReturnValue({ chat_id: '573001234567@c.us' })

  it('a pure-courtesy TEXT message is processable on a chatBot line', () => {
    const { whatsAppClient } = buildClient(
      { chatBot: true, assistant: false },
      { findSessionByChatId }
    )
    const msg = buildMsg({ type: MessageTypes.TEXT, body: 'Si' })

    expect(whatsAppClient.isProcessableMsg(msg)).toBe(true)
  })

  it('a pure-courtesy TEXT message is NOT processable on an assistant line', () => {
    const { whatsAppClient } = buildClient(
      { chatBot: false, assistant: true },
      { findSessionByChatId }
    )
    const msg = buildMsg({ type: MessageTypes.TEXT, body: 'Si' })

    expect(whatsAppClient.isProcessableMsg(msg)).toBe(false)
  })

  it('a content message containing "por favor" is processable on a chatBot line', () => {
    const { whatsAppClient } = buildClient(
      { chatBot: true, assistant: false },
      { findSessionByChatId }
    )
    const msg = buildMsg({
      type: MessageTypes.TEXT,
      body: 'Necesito un taxi en el centro por favor',
    })

    expect(whatsAppClient.isProcessableMsg(msg)).toBe(true)
  })

  it('a content message containing "por favor" is processable on an assistant line', () => {
    const { whatsAppClient } = buildClient(
      { chatBot: false, assistant: true },
      { findSessionByChatId }
    )
    const msg = buildMsg({
      type: MessageTypes.TEXT,
      body: 'Necesito un taxi en el centro por favor',
    })

    expect(whatsAppClient.isProcessableMsg(msg)).toBe(true)
  })
})

describe('WhatsAppClient.onReady conversation-turn worker registration (design D6, task 3.7)', () => {
  it('constructs ChatBot before registering the conversation-turn worker', () => {
    const ChatBotMock = jest.requireMock('../../chatBot/ChatBot').default as jest.Mock
    const mockWorker = Worker as unknown as jest.Mock
    const { whatsAppClient } = buildClient({ id: 'wp-client-order' })
    const chatBotCallsBefore = ChatBotMock.mock.invocationCallOrder.length
    const workerCallsBefore = mockWorker.mock.invocationCallOrder.length

    whatsAppClient.onReady()

    const chatBotCallOrder = ChatBotMock.mock.invocationCallOrder[chatBotCallsBefore]
    const workerCallOrder = mockWorker.mock.invocationCallOrder[workerCallsBefore]
    expect(chatBotCallOrder).toBeLessThan(workerCallOrder)
  })

  it('is idempotent: onReady firing twice for the same wpClient (reconnect) registers exactly one worker', () => {
    const mockWorker = Worker as unknown as jest.Mock
    const offNotifications = WpNotificationRepository.offNotifications as jest.Mock
    const onServiceAssigned = WpNotificationRepository.onServiceAssigned as jest.Mock
    const { whatsAppClient } = buildClient({ id: 'wp-client-onready-idempotent' })
    const callsBefore = mockWorker.mock.calls.length
    const offCallsBefore = offNotifications.mock.calls.length
    const assignedCallsBefore = onServiceAssigned.mock.calls.length

    whatsAppClient.onReady()
    whatsAppClient.onReady()

    expect(mockWorker.mock.calls.length - callsBefore).toBe(1)
    expect(
      QueueService.getInstance().hasWorker(
        getConversationTurnQueueName('wp-client-onready-idempotent')
      )
    ).toBe(true)

    // Task 2.2(d): each onReady call detaches before it re-attaches — one
    // offNotifications per onReady, ordered before that same call's
    // onServiceAssigned registration (spec: wp-notification-single-delivery).
    expect(offNotifications.mock.calls.length - offCallsBefore).toBe(2)
    expect(onServiceAssigned.mock.calls.length - assignedCallsBefore).toBe(2)
    const offOrder = offNotifications.mock.invocationCallOrder.slice(offCallsBefore)
    const assignedOrder = onServiceAssigned.mock.invocationCallOrder.slice(assignedCallsBefore)
    expect(offOrder[0]).toBeLessThan(assignedOrder[0])
    expect(offOrder[1]).toBeLessThan(assignedOrder[1])
  })

  // Task 6.1 (design D7, spec: chatbot-session-sync): onServiceChanged's unsubscribe must
  // be invoked before onReady re-registers, so a reconnect never leaves two live
  // 'child_changed' listeners on the services query.
  it('detaches the previous service-change listener before registering a new one on a second onReady', () => {
    const onServiceChanged = ServiceRepository.onServiceChanged as jest.Mock
    const { whatsAppClient } = buildClient({ id: 'wp-client-service-changed-detach' })
    const callsBefore = onServiceChanged.mock.calls.length

    whatsAppClient.onReady()
    whatsAppClient.onReady()

    const calls = onServiceChanged.mock.calls.slice(callsBefore)
    const results = onServiceChanged.mock.results.slice(callsBefore)
    expect(calls).toHaveLength(2)
    // Both registrations pass the same bound class-field callback.
    expect(calls[0][0]).toBe(calls[1][0])

    const firstUnsubscribe = results[0].value as jest.Mock
    const secondUnsubscribe = results[1].value as jest.Mock
    // Only one live listener remains: the first registration was torn down before the
    // second call re-attached, and the second (current) registration is left untouched.
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1)
    expect(secondUnsubscribe).not.toHaveBeenCalled()
  })

  it('registers a differently-named queue per wpClientId', () => {
    const { whatsAppClient: clientA } = buildClient({ id: 'wp-client-a' })
    const { whatsAppClient: clientB } = buildClient({ id: 'wp-client-b' })

    clientA.onReady()
    clientB.onReady()

    expect(QueueService.getInstance().hasWorker(getConversationTurnQueueName('wp-client-a'))).toBe(
      true
    )
    expect(QueueService.getInstance().hasWorker(getConversationTurnQueueName('wp-client-b'))).toBe(
      true
    )
  })
})

// Task 2.2 (design Decision 2, spec: wp-notification-single-delivery): serviceChanged claims
// session.notifications.<kind> synchronously, before its first await, so a concurrent
// invocation for the same service sees the flag already set and skips the send. The fake
// session below mirrors the real Session shape closely enough to exercise that race:
// setNotification flips the flag synchronously (like the real Session.setNotification does
// before awaiting Postgres) and only resolves on a later tick, and setStatus likewise
// resolves on a later tick, so two overlapping serviceChanged calls interleave exactly like
// they would against the real, Postgres-backed Session.
describe('WhatsAppClient.serviceChanged (design Decision 2, spec: wp-notification-single-delivery)', () => {
  function buildFakeSession() {
    // `events` records when each mock's own body actually settles/runs, so tests can assert
    // on real completion order (not just invocation order, which is unchanged by task 5.1 —
    // setNotification is always *called* before setStatus; what 5.1 changes is whether its
    // promise *settles* before setStatus is invoked).
    const events: string[] = []
    const session = {
      notifications: { assigned: false, arrived: false, completed: false } as Record<
        string,
        boolean
      >,
      events,
      setStatus: jest.fn(async () => {
        events.push('setStatus-called')
        await new Promise((resolve) => setImmediate(resolve))
      }),
      setNotification: jest.fn(),
    }
    // Assigned separately so the implementation can close over `session` (flips the flag
    // synchronously, exactly like the real Session.setNotification, before its own await).
    session.setNotification = jest.fn(async (kind: string) => {
      session.notifications[kind] = true
      await new Promise((resolve) => setImmediate(resolve))
      events.push('setNotification-settled')
    })
    return session
  }

  // in_progress, no metadata, with a vehicle snapshot carrying a plate — takes the
  // "assigned" branch under test without needing to mock driver/vehicle resolution.
  function buildAssignedSnapshot(): DataSnapshot {
    return {
      key: 'svc-1',
      val: () => ({
        id: 'svc-1',
        client_id: '573001112233@c.us',
        status: 'in_progress',
        driver_id: 'drv-1',
        vehicle: { plate: 'ABC123', color: null },
      }),
    } as unknown as DataSnapshot
  }

  it('concurrent invocations for the same in-progress, no-metadata service send exactly one SERVICE_ASSIGNED message', async () => {
    const session = buildFakeSession()
    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const { whatsAppClient, client } = buildClient(
      { chatBot: true, wpNotifications: false, assistant: false },
      { findSessionByChatId }
    )
    const snap = buildAssignedSnapshot()

    const p1 = whatsAppClient.serviceChanged(snap)
    const p2 = whatsAppClient.serviceChanged(snap)
    await Promise.all([p1, p2])

    expect(client.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setNotification).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledTimes(2)
  })

  it('flag already set: status is still updated, but nothing is claimed or sent again', async () => {
    const session = buildFakeSession()
    session.notifications.assigned = true
    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const { whatsAppClient, client } = buildClient(
      { chatBot: true, wpNotifications: false, assistant: false },
      { findSessionByChatId }
    )

    await whatsAppClient.serviceChanged(buildAssignedSnapshot())

    expect(session.setStatus).toHaveBeenCalledTimes(1)
    expect(session.setNotification).not.toHaveBeenCalled()
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('wpNotifications line: claims the flag and updates status but sends nothing', async () => {
    const session = buildFakeSession()
    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const { whatsAppClient, client } = buildClient(
      { chatBot: true, wpNotifications: true, assistant: false },
      { findSessionByChatId }
    )

    await whatsAppClient.serviceChanged(buildAssignedSnapshot())

    expect(session.setNotification).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledTimes(1)
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  // Task 5.1 (design D6): the claimed flag must be durably persisted before the status
  // write runs, so the status write's own re-read can never observe a stale (pre-claim)
  // notifications row. See buildFakeSession's comment: this checks settle order, not call
  // order, which is the part task 5.1 actually changes.
  it('persists the claimed notification flag before the status write runs', async () => {
    const session = buildFakeSession()
    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const { whatsAppClient } = buildClient(
      { chatBot: true, wpNotifications: false, assistant: false },
      { findSessionByChatId }
    )

    await whatsAppClient.serviceChanged(buildAssignedSnapshot())

    expect(session.events).toEqual(['setNotification-settled', 'setStatus-called'])
  })

  it('two sequential invocations, the second after the first fully resolves, send exactly once', async () => {
    const session = buildFakeSession()
    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const { whatsAppClient, client } = buildClient(
      { chatBot: true, wpNotifications: false, assistant: false },
      { findSessionByChatId }
    )

    await whatsAppClient.serviceChanged(buildAssignedSnapshot())
    await whatsAppClient.serviceChanged(buildAssignedSnapshot())

    expect(client.sendMessage).toHaveBeenCalledTimes(1)
    expect(session.setNotification).toHaveBeenCalledTimes(1)
  })
})

// Task 5.3 (design D6, spec: chatbot-session-sync): end-to-end regression wiring a REAL
// Session + a REAL ChatBot (bypassing this file's top-level ChatBot mock via
// jest.requireActual) through ChatBot.sync()'s 'modified' listener, instead of the faked
// `session` object used in the describe block above. SessionRepository.updateStatus is
// mocked to reproduce the actual bug mechanism: its own re-read can land before the
// notification claim's write commits, in which case it emits a 'modified' event carrying
// the pre-claim (stale) flag — exactly what a real Postgres round-trip race would produce.
// This test must fail when both 5.1 (ordered persistence) and 5.2 (monotonic merge) are
// reverted, and pass when either one alone is applied.
describe('WhatsAppClient.serviceChanged — duplicate SERVICE_ASSIGNED regression (design D6, spec: chatbot-session-sync, task 5.3)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const chatId = '573005550000'
  const wpClientId = 'wp-client-5-3'

  function buildSnapshot(): DataSnapshot {
    return {
      key: 'svc-5-3',
      val: () => ({
        id: 'svc-5-3',
        client_id: chatId,
        status: 'in_progress',
        driver_id: 'drv-1',
        vehicle: { plate: 'ABC123', color: null },
      }),
    } as unknown as DataSnapshot
  }

  it('sends SERVICE_ASSIGNED exactly once across two child_changed events even when the status write races a stale notifications re-read', async () => {
    const RealChatBot = jest.requireActual('../../chatBot/ChatBot').default
    const { whatsAppClient, client } = buildClient({
      id: wpClientId,
      chatBot: true,
      wpNotifications: false,
      assistant: false,
    })

    let capturedListener!: (type: string, session: Session) => void | Promise<void>
    jest.spyOn(SessionRepository, 'getActiveSessions').mockResolvedValue([])
    jest
      .spyOn(SessionRepository, 'sessionActiveListener')
      .mockImplementation((_wpClientId, listener) => {
        capturedListener = listener
      })

    // Flips true only once the (mocked) notification-claim round trip finishes, so
    // updateStatus's mock below can tell whether its own "read" would, against the real
    // Postgres-backed repository, have observed the claim yet.
    let notificationCommitted = false
    jest.spyOn(SessionRepository, 'updateNotification').mockImplementation(async () => {
      await flushMicrotasks()
      notificationCommitted = true
    })
    jest.spyOn(SessionRepository, 'updateStatus').mockImplementation(async (session) => {
      if (!notificationCommitted) {
        const staleEventSession = new Session(chatId)
        staleEventSession.id = session.id
        staleEventSession.wp_client_id = wpClientId
        staleEventSession.notifications = {
          greeting: false,
          assigned: false,
          arrived: false,
          completed: false,
        }
        await capturedListener('modified', staleEventSession)
      }
      return session
    })

    const realChatBot = new RealChatBot(client, wpClientId)
    realChatBot.sync()
    await flushMicrotasks()

    const sessionInMap = new Session(chatId)
    sessionInMap.id = 'session-5-3'
    sessionInMap.wp_client_id = wpClientId
    await capturedListener('added', sessionInMap)

    ;(whatsAppClient as any).chatBot = realChatBot

    await whatsAppClient.serviceChanged(buildSnapshot())
    await whatsAppClient.serviceChanged(buildSnapshot())

    expect(client.sendMessage).toHaveBeenCalledTimes(1)
  })
})

// These tests exercise the real WhatsAppClient + OfficialClient wiring (task 1.4a, design D1,
// spec: wp-inbound-single-processing) instead of the injected-mock-client pattern used above,
// because the bug is specifically about what initClient() does to the OfficialClient
// singleton's eventCallbacks across wrapper recreations. `init` is stubbed on each wrapper so
// initClient() never reaches the real client.initialize()/onReady chain (network calls,
// ChatBot construction) — only the synchronous listener (de)registration is under test.
describe('WhatsAppClient.initClient() over the OfficialClient singleton (spec: wp-inbound-single-processing, task 1.4a)', () => {
  const REGISTERED_EVENTS = [
    WpEvents.QR_RECEIVED,
    WpEvents.READY,
    WpEvents.AUTHENTICATED,
    WpEvents.AUTHENTICATION_FAILURE,
    WpEvents.STATE_CHANGED,
    WpEvents.DISCONNECTED,
    WpEvents.LOADING_SCREEN,
    WpEvents.MESSAGE_RECEIVED,
  ]

  function buildOfficialWrapper(wpClientId: string): WhatsAppClient {
    const wrapper = new WhatsAppClient(
      buildWpClient({ id: wpClientId, service: WpClients.OFFICIAL })
    )
    wrapper.init = jest.fn().mockResolvedValue(undefined)
    wrapper.onMessageReceived = jest.fn().mockResolvedValue(undefined)
    return wrapper
  }

  it('initClient() called twice against the same OfficialClient singleton leaves exactly one callback per event, and triggerEvent(MESSAGE_RECEIVED) invokes onMessageReceived once', () => {
    const wpClientId = 'wp-client-official-idempotent'

    const wrapperA = buildOfficialWrapper(wpClientId)
    wrapperA.initClient()

    const wrapperB = buildOfficialWrapper(wpClientId)
    wrapperB.initClient()

    // ClientFactory.build() returns the same OfficialClient.instances[wpClientId] singleton both times.
    expect(wrapperA.client).toBe(wrapperB.client)

    const eventCallbacks = (wrapperB.client as any).eventCallbacks
    for (const event of REGISTERED_EVENTS) {
      expect(eventCallbacks[event]).toHaveLength(1)
    }

    const msg = buildMsg({ id: 'wamid.idempotent-1' })
    ;(wrapperB.client as OfficialClient).triggerEvent(WpEvents.MESSAGE_RECEIVED, msg)

    expect(wrapperB.onMessageReceived).toHaveBeenCalledTimes(1)
    expect(wrapperB.onMessageReceived).toHaveBeenCalledWith(msg)
    expect(wrapperA.onMessageReceived).not.toHaveBeenCalled()
  })

  it('removeAllListeners() detaches previously registered callbacks so a stale wrapper stops receiving events', () => {
    const wpClientId = 'wp-client-official-remove-listeners'

    const wrapper = buildOfficialWrapper(wpClientId)
    wrapper.initClient()
    const client = wrapper.client as OfficialClient

    client.removeAllListeners()
    client.triggerEvent(WpEvents.MESSAGE_RECEIVED, buildMsg())

    expect(wrapper.onMessageReceived).not.toHaveBeenCalled()
  })
})

// Regression test for the combined failure chain described in design.md's Context section
// (spec: wp-inbound-single-processing, task 2.4): OfficialClient's listener leak (fixed by
// D1) plus SessionRepository.addMsg's old re-parenting behavior (fixed by D3) used to
// multiply into two enqueued conversation-turn jobs per inbound message. D1's own coverage
// lives in task 1.4a above (initClient() collapses the singleton back to one listener); this
// test instead proves D3 is a real defense-in-depth backstop, not just a unit-level guarantee:
// even when the singleton is deliberately put back into the pre-D1 "two live listeners"
// state (bypassing initClient()'s removeAllListeners(), since calling it normally would
// immediately re-collapse to one listener and never exercise this path), and each listener
// is wired to its own ChatBot generation's own in-memory Session (mirroring "each ChatBot
// resolves/creates its own active session for the chat" from design.md point 3), exactly one
// conversation-turn job is enqueued for the one inbound message.
//
// What is real: WhatsAppClient.onMessageReceived (both instances), the OfficialClient
// singleton's event fan-out (on/triggerEvent), and Session.addMsg -> SessionRepository.addMsg
// (the actual D3 cross-session dedup logic).
// What is mocked: ChatBot itself (replaced with a minimal stand-in exposing
// findSessionByChatId/processMessage, as the rest of this file already does) so the test
// doesn't need ChatBot's sync/session-map machinery or Firebase-backed chat lookups; the
// Sequelize model layer (ChatSessionRecord.findByPk, WhatsappMessageRecord.findOrCreate/
// update/findOne) via an in-memory fake shared "DB", the same way SessionRepository.spec.ts
// tests D3 in isolation; and QueueService.add (spied, no-op) to count enqueued turns without
// touching Redis/BullMQ. The fake DB seeds the inbound row with chatSessionId: null before the
// event fires, mirroring the real precondition (MessageController.ts / WhatsAppClient.ts
// pre-persist inbound rows with chatSessionId: null ahead of the chatbot run) that the old
// re-parenting bug misread as a cross-session duplicate and silently dropped.
describe('Combined failure chain: two WhatsAppClient generations over one OfficialClient singleton (design D1+D3, spec: wp-inbound-single-processing, task 2.4)', () => {
  const wpClientId = 'wp-client-official-combined-chain'

  function buildGeneration(session: Session) {
    const wrapper = new WhatsAppClient(
      buildWpClient({ id: wpClientId, service: WpClients.OFFICIAL })
    )
    wrapper.init = jest.fn().mockResolvedValue(undefined)
    ;(wrapper as any).chatBot = {
      findSessionByChatId: jest.fn().mockReturnValue(undefined),
      processMessage: async (msg: WpMessageInterface) => {
        await session.addMsg(msg)
      },
    }
    // Spy before registering the listener so the callback captured by client.on(...)
    // is the spy itself, letting the assertions below prove both generations really
    // received the fan-out (i.e. that the "pre-D1" duplicate-consumer state was real).
    const onMessageReceivedSpy = jest.spyOn(wrapper, 'onMessageReceived')
    return { wrapper, onMessageReceivedSpy }
  }

  it('enqueues exactly one conversation-turn job for one inbound message even when both generations receive it and each owns its own session', async () => {
    const sessionA = new Session('chat-1')
    sessionA.id = 'session-gen-A'
    sessionA.setWpClientId(wpClientId)

    const sessionB = new Session('chat-1')
    sessionB.id = 'session-gen-B'
    sessionB.setWpClientId(wpClientId)

    const { wrapper: wrapperA, onMessageReceivedSpy: spyA } = buildGeneration(sessionA)
    wrapperA.initClient()

    const { wrapper: wrapperB, onMessageReceivedSpy: spyB } = buildGeneration(sessionB)
    wrapperB.client = wrapperA.client

    // Reproduce the pre-D1 residual-listener state directly: register generation B's
    // handler on the already-live singleton without going through wrapperB.initClient()
    // (which would call the now-fixed removeAllListeners() and immediately clear
    // generation A's listener instead of leaving both registered).
    ;(wrapperA.client as OfficialClient).on(WpEvents.MESSAGE_RECEIVED, wrapperB.onMessageReceived)

    // Shared in-memory "DB": both generations' SessionRepository.addMsg calls look up the
    // same wpClientId/messageId row.
    const sessionRecords: Record<string, { id: string; wpClientId: string; chatId: string }> = {
      'session-gen-A': { id: 'session-gen-A', wpClientId, chatId: 'chat-1' },
      'session-gen-B': { id: 'session-gen-B', wpClientId, chatId: 'chat-1' },
    }
    ;(ChatSessionRecord.findByPk as jest.Mock).mockImplementation(
      async (id: string) => sessionRecords[id]
    )

    const msg = buildMsg({
      id: 'wamid.combined-1',
      type: MessageTypes.TEXT,
      from: '573001234567@c.us',
      body: 'Hola',
    })

    // Reproduce the real precondition: the webhook pre-persists the inbound row with
    // chatSessionId: null before either chatbot generation ever calls addMsg.
    const messageRecords: Array<Record<string, unknown>> = [
      {
        wpClientId,
        messageId: msg.id,
        chatId: 'chat-1',
        chatSessionId: null,
        created_at: msg.timestamp,
        type: MessageTypes.TEXT,
        body: msg.body,
        fromMe: false,
        processed: false,
        location: null,
        interactive: null,
        interactiveReply: null,
        save: jest.fn().mockResolvedValue(undefined),
      },
    ]

    function findRecord(wpClientIdArg: string, messageId: string) {
      return messageRecords.find((r) => r.wpClientId === wpClientIdArg && r.messageId === messageId)
    }

    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockImplementation(
      async ({ where, defaults }: { where: any; defaults: any }) => {
        const existing = findRecord(where.wpClientId, where.messageId)
        if (existing) return [existing, false]
        const record = { ...defaults, save: jest.fn().mockResolvedValue(undefined) }
        messageRecords.push(record)
        return [record, true]
      }
    )

    ;(WhatsappMessageRecord.update as jest.Mock).mockImplementation(
      async (values: Record<string, unknown>, { where }: { where: any }) => {
        const record = findRecord(where.wpClientId, where.messageId)
        if (!record || record.chatSessionId !== where.chatSessionId) {
          return [0]
        }
        Object.assign(record, values)
        return [1]
      }
    )

    ;(WhatsappMessageRecord.findOne as jest.Mock).mockImplementation(
      async ({ where }: { where: any }) => findRecord(where.wpClientId, where.messageId) ?? null
    )

    const addSpy = jest.spyOn(QueueService.getInstance(), 'add').mockImplementation(() => {})

    ;(wrapperA.client as OfficialClient).triggerEvent(WpEvents.MESSAGE_RECEIVED, msg)
    await flushMicrotasks()
    await flushMicrotasks()

    // Both generations really received the one inbound message (the duplicate-consumer
    // condition D1 normally prevents was genuinely reproduced here)...
    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)

    // ...yet D3's null-session adoption + cross-session dedup means the row was only ever
    // adopted by one of the two sessions...
    expect(messageRecords).toHaveLength(1)
    expect(messageRecords[0].chatSessionId).not.toBeNull()
    expect(['session-gen-A', 'session-gen-B']).toContain(messageRecords[0].chatSessionId)

    // ...and therefore only one conversation-turn job was enqueued.
    expect(addSpy).toHaveBeenCalledTimes(1)

    addSpy.mockRestore()
  })
})

// Task 4.4 (spec: wp-interactive-fallback, "Plain-text option picks are promoted to
// interactive replies"): resolveInteractiveOption's matching rules are unit-tested on
// their own (resolveInteractiveOption.spec.ts); these tests instead prove the wiring
// inside onMessageReceived — that a non-Official line actually calls
// MessageRepository.findLatestOutbound, rewrites the WpMessageInterface in place on a
// match, and leaves it alone otherwise (including when it already arrived INTERACTIVE).
describe('WhatsAppClient.onMessageReceived interactive option resolution (spec: wp-interactive-fallback, task 4.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    ;(Store.getInstance().getChatById as jest.Mock).mockResolvedValue({ id: 'chat-1' })
  })

  it('Ordinal pick: "1" is promoted to an INTERACTIVE message whose button_reply.id is CANCEL, and body becomes the id', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: buildButtonOffer(),
    })
    const findSessionByChatId = jest.fn().mockReturnValue({ chat_id: '573001234567@c.us' })
    const { whatsAppClient, chatBot } = buildClient(
      { service: WpClients.BAILEYS },
      { findSessionByChatId }
    )
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-ordinal-1',
      type: MessageTypes.TEXT,
      body: '1',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(MessageRepository.findLatestOutbound).toHaveBeenCalledWith('wp-client-1', msg.from)
    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('CANCEL')
    expect(msg.interactiveReply).toEqual({
      type: 'button_reply',
      button_reply: { id: 'CANCEL', title: 'Cancelar' },
    })
    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
  })

  it('Title pick: "insistir" is promoted to a button_reply of INSIST', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: buildButtonOffer(),
    })
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-title-1',
      type: MessageTypes.TEXT,
      body: 'insistir',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('INSIST')
    expect(msg.interactiveReply).toEqual({
      type: 'button_reply',
      button_reply: { id: 'INSIST', title: 'Insistir' },
    })
  })

  it('List pick becomes a list reply: "3" resolves to the third row across sections', async () => {
    const listOffer: Interactive = {
      type: 'list',
      action: {
        sections: [
          {
            rows: [
              { id: 'A', title: 'Fila A' },
              { id: 'B', title: 'Fila B' },
            ],
          },
          { rows: [{ id: 'C', title: 'Fila C' }] },
        ],
      },
    }
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: listOffer,
    })
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-list-1',
      type: MessageTypes.TEXT,
      body: '3',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('C')
    expect(msg.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'C', title: 'Fila C' },
    })
  })

  it('Extra words are not a pick: "2 gracias" stays TEXT (resolution wiring, independent of the unrelated courtesy filter)', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: buildButtonOffer(),
    })
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-extra-1',
      type: MessageTypes.TEXT,
      body: '2 gracias',
    })

    await whatsAppClient.onMessageReceived(msg)

    // "2 gracias" is the spec's own example. isProcessableMsg separately treats it as
    // a courtesy message (MessageHelper.isCourtesyMessage) and never reaches
    // ChatBot.processMessage regardless of promotion — that gate is pre-existing and
    // out of scope here; this test only asserts resolution left the message as TEXT.
    expect(msg.type).toBe(MessageTypes.TEXT)
    expect(msg.body).toBe('2 gracias')
    expect(msg.interactiveReply).toBeNull()
  })

  it('Options superseded by a later plain message: the chat’s latest outbound carries no interactive payload, so "1" stays TEXT', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({ interactive: null })
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-superseded-1',
      type: MessageTypes.TEXT,
      body: '1',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(msg.type).toBe(MessageTypes.TEXT)
    expect(msg.body).toBe('1')
  })

  it('a chat with no stored outbound message at all leaves "1" as TEXT', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue(null)
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-nooutbound-1',
      type: MessageTypes.TEXT,
      body: '1',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(msg.type).toBe(MessageTypes.TEXT)
  })

  it('Already INTERACTIVE: a message that already arrived as INTERACTIVE is never sent through resolution', async () => {
    const findSessionByChatId = jest.fn().mockReturnValue({ chat_id: '573001234567@c.us' })
    const { whatsAppClient, chatBot } = buildClient(
      { service: WpClients.BAILEYS },
      { findSessionByChatId }
    )
    const originalReply = {
      type: 'button_reply' as const,
      button_reply: { id: 'NATIVE', title: 'Native' },
    }
    const msg = buildBaileysMsg({
      id: 'wamid.interactive-already-1',
      type: MessageTypes.INTERACTIVE,
      body: 'NATIVE',
      interactiveReply: originalReply,
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(MessageRepository.findLatestOutbound).not.toHaveBeenCalled()
    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('NATIVE')
    expect(msg.interactiveReply).toBe(originalReply)
    expect(chatBot.processMessage).toHaveBeenCalledWith(msg)
  })

  // Candidate-list race (chatbot-agent-conversation follow-up, "render search_place
  // candidates as a selectable list"): a candidate list is sent, then an unrelated
  // outbound message is sent afterwards (e.g. a later turn's reply, or a lifecycle
  // notification) — findLatestOutbound now points at that later message, which carries
  // no `interactive` payload, so resolveInteractiveOption has nothing to match against
  // and returns null. The reply stays plain TEXT rather than resolving against the
  // stale list; this is documented degradation, not a bug — the model still resolves
  // "2" from session.state.pending_candidates as ordinary free text.
  it('candidate-list race: an unrelated message sent after the list means the reply stays TEXT, not a resolved pick', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({ interactive: null })
    const { whatsAppClient } = buildClient({ service: WpClients.BAILEYS })
    const msg = buildBaileysMsg({
      id: 'wamid.candidate-list-race-1',
      type: MessageTypes.TEXT,
      body: '2',
    })

    await whatsAppClient.onMessageReceived(msg)

    expect(MessageRepository.findLatestOutbound).toHaveBeenCalledWith('wp-client-1', msg.from)
    expect(msg.type).toBe(MessageTypes.TEXT)
    expect(msg.body).toBe('2')
    expect(msg.interactiveReply).toBeNull()
  })
})

// Task 4.4, scenario "Promoted pick skips the debounce window": drives the real
// Session.addMsg -> enqueueConversationTurn path (the same pattern as the combined
// failure chain test above) instead of a mocked ChatBot, to prove the promoted
// message's conversation turn is actually enqueued with delay 0.
describe('WhatsAppClient.onMessageReceived promoted pick skips the debounce window (spec: wp-interactive-fallback, task 4.4)', () => {
  it('enqueues the promoted conversation turn with delay 0, matching a native button reply', async () => {
    const wpClientId = 'wp-client-delay0'

    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: buildButtonOffer(),
    })
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    ;(Store.getInstance().getChatById as jest.Mock).mockResolvedValue({ id: 'chat-delay0' })
    ;(ChatSessionRecord.findByPk as jest.Mock).mockResolvedValue({
      wpClientId,
      chatId: 'chat-delay0',
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockImplementation(
      async ({ defaults }: { defaults: Record<string, unknown> }) => [{ ...defaults }, true]
    )

    const session = new Session('chat-delay0')
    session.id = 'session-delay0'
    session.setWpClientId(wpClientId)

    const findSessionByChatId = jest.fn().mockReturnValue(session)
    const processMessage = jest.fn(async (msg: WpMessageInterface) => {
      await session.addMsg(msg)
    })
    const { whatsAppClient } = buildClient(
      { id: wpClientId, service: WpClients.BAILEYS },
      { findSessionByChatId, processMessage }
    )

    const addSpy = jest.spyOn(QueueService.getInstance(), 'add').mockImplementation(() => {})

    const msg = buildBaileysMsg({ id: 'wamid.delay0-1', type: MessageTypes.TEXT, body: '1' })
    await whatsAppClient.onMessageReceived(msg)

    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(addSpy).toHaveBeenCalledWith(
      getConversationTurnQueueName(wpClientId),
      expect.objectContaining({ sessionId: 'session-delay0' }),
      expect.objectContaining({ delay: 0 })
    )

    addSpy.mockRestore()
  })
})

// Regression test for the crash reported from container logs: initClient() registers
// onMessageReceived before onReady ever assigns this.chatBot, so a restart that delivers
// queued/offline Baileys messages before READY used to dereference `this.chatBot` in
// isProcessableMsg and crash the whole process with an unhandled rejection. The fix guards
// the chatbot-processing branch on `this.chatBot` and wraps the handler body in try/catch.
describe('WhatsAppClient.onMessageReceived guards against a missing chatBot (crash-on-inbound-before-ready fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue(null)
    ;(Store.getInstance().getChatById as jest.Mock).mockResolvedValue({ id: 'chat-not-ready' })
  })

  // Builds a wrapper wired to a fake transport, deliberately leaving this.chatBot
  // unassigned to reproduce the pre-onReady state (onMessageReceived's real guard is
  // what's under test here, unlike buildClient() above which always injects a chatBot).
  function buildClientWithoutChatBot(wpClientOverrides: Partial<WpClient> = {}) {
    const wpClient = buildWpClient({ service: WpClients.BAILEYS, ...wpClientOverrides })
    const whatsAppClient = new WhatsAppClient(wpClient)
    const client: jest.Mocked<WPClientInterface> = {
      serviceName: wpClient.service,
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      getWWebVersion: jest.fn(),
      getState: jest.fn(),
      getChatById: jest.fn(),
      logout: jest.fn(),
      initialize: jest.fn(),
      getInfo: jest.fn(),
    }
    ;(whatsAppClient as any).client = client
    return { whatsAppClient, client }
  }

  it('does not throw and skips chatbot processing when a message arrives before onReady assigns chatBot, while still persisting it for the boot sweep', async () => {
    const { whatsAppClient, client } = buildClientWithoutChatBot()
    const isProcessableSpy = jest.spyOn(whatsAppClient, 'isProcessableMsg')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const msg = buildBaileysMsg({ id: 'wamid.not-ready-1', type: MessageTypes.TEXT, body: 'Hola' })

    await expect(whatsAppClient.onMessageReceived(msg)).resolves.toBeUndefined()

    expect(isProcessableSpy).not.toHaveBeenCalled()
    expect(client.sendTypingIndicator).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      'onMessageReceived: chatBot not ready yet, message queued for boot sweep',
      'Test Client',
      msg.from
    )
    // Inbound persistence still runs so onReady's boot sweep can pick this message up later.
    expect(MessageRepository.addMessage).toHaveBeenCalledWith(
      'wp-client-1',
      'chat-not-ready',
      expect.objectContaining({ id: msg.id, body: 'Hola' }),
      expect.objectContaining({ processed: false })
    )

    warnSpy.mockRestore()
  })

  it('never lets an error thrown while handling one inbound message escape as an unhandled rejection', async () => {
    const { whatsAppClient } = buildClientWithoutChatBot()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const captureSpy = jest.spyOn(Sentry, 'captureException').mockImplementation(() => '' as any)
    const boom = new Error('boom')
    ;(MessageRepository.addMessage as jest.Mock).mockRejectedValueOnce(boom)
    const msg = buildBaileysMsg({ id: 'wamid.not-ready-2', type: MessageTypes.TEXT, body: 'Hola' })

    await expect(whatsAppClient.onMessageReceived(msg)).resolves.toBeUndefined()

    expect(captureSpy).toHaveBeenCalledWith(boom)
    expect(logSpy).toHaveBeenCalledWith('onMessageReceived Error', 'Test Client', boom.message)

    logSpy.mockRestore()
    captureSpy.mockRestore()
  })
})
