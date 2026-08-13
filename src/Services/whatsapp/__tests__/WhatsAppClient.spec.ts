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
    onServiceChanged: jest.fn(),
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

import { Worker } from 'bullmq'
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

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

function buildWpClient(overrides: Partial<WpClient> = {}): WpClient {
  return {
    id: 'wp-client-1',
    alias: 'Test Client',
    wpNotifications: false,
    full: false,
    chatBot: true,
    assistant: false,
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

  it('is idempotent: onReady firing twice for the same wpClient (reconnect / restartChromium) registers exactly one worker', () => {
    const mockWorker = Worker as unknown as jest.Mock
    const { whatsAppClient } = buildClient({ id: 'wp-client-onready-idempotent' })
    const callsBefore = mockWorker.mock.calls.length

    whatsAppClient.onReady()
    whatsAppClient.onReady()

    expect(mockWorker.mock.calls.length - callsBefore).toBe(1)
    expect(
      QueueService.getInstance().hasWorker(
        getConversationTurnQueueName('wp-client-onready-idempotent')
      )
    ).toBe(true)
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
      return messageRecords.find(
        (r) => r.wpClientId === wpClientIdArg && r.messageId === messageId
      )
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
