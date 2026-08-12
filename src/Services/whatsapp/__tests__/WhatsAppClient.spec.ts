// Store's private constructor touches Firebase/Redis-backed repositories; stub it so the
// module can be loaded and `new WhatsAppClient()` constructed without a live backend.
jest.mock('../../store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
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

import { Worker } from 'bullmq'
import { WhatsAppClient } from '../WhatsAppClient'
import { WpClient } from '../../../Interfaces/WpClient'
import { WpClients } from '../constants/WPClients'
import { MessageTypes } from '../constants/MessageTypes'
import { WpMessageInterface } from '../interfaces/WpMessageInterface'
import { WPClientInterface } from '../interfaces/WPClientInterface'
import QueueService from '../../queue/QueueService'
import { getConversationTurnQueueName } from '../../chatBot/turns/ConversationTurnQueue'

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
    getWWebVersion: jest.fn(),
    getState: jest.fn(),
    getChatById: jest.fn(),
    logout: jest.fn(),
    initialize: jest.fn(),
    getInfo: jest.fn(),
  }
  ;(whatsAppClient as any).client = client

  const chatBot = {
    findSessionByChatId: chatBotOverrides.findSessionByChatId ?? jest.fn().mockReturnValue(undefined),
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
