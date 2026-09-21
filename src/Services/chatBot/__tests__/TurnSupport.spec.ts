// Mock Session before any module that triggers the circular Session -> TurnDispatcher ->
// AgentTurn/DeterministicHandlers/LocationAssistantFlow -> Session cycle.
jest.mock('../../../Models/Session', () => {
  const SessionStatuses = {
    BOOKING: 'BOOKING',
    REQUESTING_SERVICE: 'REQUESTING_SERVICE',
    SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    SUPPORT: 'SUPPORT',
  }
  class MockSession {
    static STATUS_BOOKING = SessionStatuses.BOOKING
    static STATUS_REQUESTING_SERVICE = SessionStatuses.REQUESTING_SERVICE
    static STATUS_SERVICE_IN_PROGRESS = SessionStatuses.SERVICE_IN_PROGRESS
    static STATUS_COMPLETED = SessionStatuses.COMPLETED
    static STATUS_SUPPORT = SessionStatuses.SUPPORT
  }
  return { __esModule: true, default: MockSession }
})

jest.mock('../../../Repositories/SessionRepository', () => ({
  __esModule: true,
  default: {
    addMsg: jest.fn().mockResolvedValue({ created: true, id: 'mock-outbound-id' }),
  },
}))

jest.mock('../../../Helpers/DateHelper', () => ({
  __esModule: true,
  default: {
    unix: jest.fn().mockReturnValue(1700000000),
  },
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

import { sendGatedMessage } from '../TurnSupport'
import SessionRepository from '../../../Repositories/SessionRepository'
import DateHelper from '../../../Helpers/DateHelper'
import * as Sentry from '@sentry/node'
import { DiscardedTurnError } from '../turns/DiscardedTurnError'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'
import { SessionStatuses } from '../../../Types/SessionStatuses'

function buildMockSession(chatId: string) {
  return {
    id: 'session-1',
    chat_id: chatId,
    wp_client_id: 'wp-client-1',
    messages: { set: jest.fn() },
    setStatus: jest.fn().mockResolvedValue(undefined),
    setPlace: jest.fn().mockResolvedValue(undefined),
    setPlaceOptions: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
  }
}

function buildOutboundMessage(overrides: Partial<ChatBotMessage> = {}): ChatBotMessage {
  return {
    id: 'msg-1',
    name: 'Test Message',
    description: '',
    message: 'hola',
    enabled: true,
    interactive: null,
    ...overrides,
  }
}

// Ported from the retired ResponseContract.spec.ts (task 3.4/5.1): design D3's
// "Outbound sends MUST go through the same gate + persistence path" now lives
// solely in TurnSupport.sendGatedMessage, reused by the agent turn and the
// deterministic flows. Its turn-gate check (session.assertTurnStillValid())
// MUST run before the retryPromise(...).catch(Sentry.captureException +
// exit(1)) block, throwing (not silently resolving) so any .then()-chained
// mutation a caller makes after a send never executes for a stale turn.
describe('sendGatedMessage turn gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects with DiscardedTurnError and never sends when the turn is stale', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest
      .fn()
      .mockRejectedValue(new DiscardedTurnError('superseded'))

    await expect(
      sendGatedMessage(mockSession as any, buildOutboundMessage())
    ).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(mockSession.sendMessage).not.toHaveBeenCalled()
  })

  it('never reaches the retryPromise/catch block: process.exit and Sentry.captureException are NOT invoked on a benign discard', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest
      .fn()
      .mockRejectedValue(new DiscardedTurnError('superseded'))

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const sentrySpy = jest.spyOn(Sentry, 'captureException')

    await expect(
      sendGatedMessage(mockSession as any, buildOutboundMessage())
    ).rejects.toBeInstanceOf(DiscardedTurnError)

    // A regression here (assertTurnStillValid moved past the retryPromise/catch,
    // or the check turned into a no-op resolve) would crash the process via
    // exit(1) on every benign discard — see design.md D3's placement hazard.
    expect(exitSpy).not.toHaveBeenCalled()
    expect(sentrySpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
  })

  it('does not run .then()-chained mutations after a blocked send (the exact hazard design D3 exists to prevent)', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest
      .fn()
      .mockRejectedValue(new DiscardedTurnError('superseded'))

    // Mirrors the exact chained-mutation pattern callers use after a send
    // (e.g. the old AskingForPlace/runPlaceSearchFlow:
    // sendMessage(...).then(async () => { setStatus(); setPlace(); setPlaceOptions() })).
    // If sendGatedMessage silently resolved instead of throwing on a stale
    // turn, this .then() callback would run and leak a stale mutation.
    const chain = sendGatedMessage(mockSession as any, buildOutboundMessage()).then(async () => {
      await mockSession.setStatus(SessionStatuses.BOOKING)
      await mockSession.setPlace({} as never)
      await mockSession.setPlaceOptions([])
    })

    await expect(chain).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(mockSession.setStatus).not.toHaveBeenCalled()
    expect(mockSession.setPlace).not.toHaveBeenCalled()
    expect(mockSession.setPlaceOptions).not.toHaveBeenCalled()
  })

  it('skips sending and persisting entirely when the catalog message is disabled', async () => {
    const mockSession = buildMockSession('573001234567@c.us')

    await sendGatedMessage(mockSession as any, buildOutboundMessage({ enabled: false }))

    expect(mockSession.assertTurnStillValid).not.toHaveBeenCalled()
    expect(mockSession.sendMessage).not.toHaveBeenCalled()
    expect(SessionRepository.addMsg).not.toHaveBeenCalled()
  })
})

// Task 5.2 (design D9, spec: wp-send-failure-resilience "Send failures never
// terminate the process"): retryPromise used to take an already-created
// promise, so every "retry" re-awaited the same settled rejection and
// session.sendMessage was invoked only once no matter how many retries were
// configured. Fixed to take a factory so each attempt issues a new send.
describe('sendGatedMessage retry-then-fail (design D9)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('invokes session.sendMessage three times (a fresh send per attempt) on repeated rejection, then rejects', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.sendMessage = jest.fn().mockRejectedValue(new Error('line disconnected'))

    const outcome = sendGatedMessage(mockSession as any, buildOutboundMessage())
    const assertion = expect(outcome).rejects.toThrow('line disconnected')

    // Two retries are scheduled 2s apart between the three attempts.
    await jest.advanceTimersByTimeAsync(2000)
    await jest.advanceTimersByTimeAsync(2000)

    await assertion
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3)
  })

  it('logs { wpClientId, chatId, error }, reports to Sentry, rethrows, and never calls process.exit', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    const sendError = new Error('provider error')
    mockSession.sendMessage = jest.fn().mockRejectedValue(sendError)

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const outcome = sendGatedMessage(mockSession as any, buildOutboundMessage())
    const assertion = expect(outcome).rejects.toThrow('provider error')

    await jest.advanceTimersByTimeAsync(2000)
    await jest.advanceTimersByTimeAsync(2000)

    await assertion

    expect(errorSpy).toHaveBeenCalledWith(
      'failed to send gated message',
      expect.objectContaining({
        wpClientId: mockSession.wp_client_id,
        chatId: mockSession.chat_id,
        error: sendError,
      })
    )
    expect(Sentry.captureException).toHaveBeenCalledWith(sendError)
    expect(exitSpy).not.toHaveBeenCalled()
    // The failed send must not be persisted as an outbound message.
    expect(SessionRepository.addMsg).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

// Ported from the retired ResponseContract.spec.ts (task 3.4/5.1).
describe('sendGatedMessage recordOutboundMessage (happy path)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(DateHelper.unix as jest.Mock).mockReturnValue(1700000000)
  })

  it('records the outbound message with a unix-seconds created_at, not milliseconds', async () => {
    const mockSession = buildMockSession('573001234567@c.us')

    await sendGatedMessage(mockSession as any, buildOutboundMessage())

    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1)
    expect(SessionRepository.addMsg).toHaveBeenCalledTimes(1)

    const [sessionId, persistedMessage, isOutbound] = (SessionRepository.addMsg as jest.Mock).mock
      .calls[0]
    expect(sessionId).toBe(mockSession.id)
    expect(isOutbound).toBe(true)
    expect(persistedMessage.created_at).toBe(1700000000)
    // Guards the regression: a millisecond timestamp is always >= 1e11 while a
    // unix-seconds timestamp for any real-world date stays well below it.
    expect(persistedMessage.created_at).toBeLessThan(1e11)

    expect(mockSession.messages.set).toHaveBeenCalledTimes(1)
    expect(mockSession.messages.set).toHaveBeenCalledWith(persistedMessage.id, persistedMessage)
  })

  // Task 4.5 (spec: wp-interactive-fallback, "Outbound interactive payloads are
  // persisted on every send path"): the turn path used to always persist `null`,
  // leaving resolveInteractiveOption's findLatestOutbound lookup unable to see
  // options offered by a conversation turn. This mirrors what
  // WhatsAppClient.sendMessage already stores for the notification path.
  it('persists the catalog message interactive payload instead of null', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    const interactive = {
      type: 'button' as const,
      body: { text: 'Seguimos buscando conductor.' },
      action: {
        buttons: [
          { type: 'reply' as const, reply: { id: 'CANCEL', title: 'Cancelar' } },
          { type: 'reply' as const, reply: { id: 'INSIST', title: 'Insistir' } },
        ],
      },
    }

    await sendGatedMessage(mockSession as any, buildOutboundMessage({ interactive }))

    const [, persistedMessage] = (SessionRepository.addMsg as jest.Mock).mock.calls[0]
    expect(persistedMessage.interactive).toEqual(interactive)
  })
})
