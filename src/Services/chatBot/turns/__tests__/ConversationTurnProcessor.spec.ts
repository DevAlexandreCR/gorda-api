import { Store } from '../../../store/Store'
import SessionRepository from '../../../../Repositories/SessionRepository'
import Session from '../../../../Models/Session'
import { SessionStatuses } from '../../../../Types/SessionStatuses'
import { DiscardedTurnError } from '../DiscardedTurnError'
import { dispatchTurn } from '../../TurnDispatcher'
import { processConversationTurn } from '../ConversationTurnProcessor'
import { ConversationTurnPayload } from '../ConversationTurnQueue'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

jest.mock('../../../store/Store', () => ({
  Store: { getInstance: jest.fn() },
}))

jest.mock('../../TurnDispatcher', () => ({
  dispatchTurn: jest.fn(),
}))

function buildPayload(overrides: Partial<ConversationTurnPayload> = {}): ConversationTurnPayload {
  return {
    wpClientId: 'wp-client-1',
    sessionId: 'session-1',
    chatId: 'chat-1',
    messageId: 'wamid-active',
    ...overrides,
  }
}

function buildMergedMessage(overrides: Partial<WpMessage> = {}): WpMessage {
  return {
    created_at: 1000,
    id: 'wamid-active',
    type: MessageTypes.TEXT,
    msg: 'hola',
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
    ...overrides,
  }
}

// Fake Session double: only the surface processConversationTurn touches.
function buildFakeSession(
  overrides: Partial<{
    processMessage: jest.Mock
  }> = {}
) {
  return {
    beginTurn: jest.fn(),
    endTurn: jest.fn(),
    buildMergedUnprocessedMessage: jest.fn().mockReturnValue(buildMergedMessage()),
    getUnprocessedMessagesArray: jest.fn().mockReturnValue([buildMergedMessage()]),
    processMessage: overrides.processMessage ?? jest.fn().mockResolvedValue('completed'),
  }
}

function mockResolvedWhatsappClient(session: ReturnType<typeof buildFakeSession> | undefined) {
  const getChatBot = jest.fn().mockReturnValue({
    getSessionById: jest.fn().mockReturnValue(session),
  })
  const whatsappClient = { getChatBot }
  ;(Store.getInstance as jest.Mock).mockReturnValue({
    getWhatsAppClient: jest.fn().mockReturnValue(whatsappClient),
  })
  return whatsappClient
}

describe('processConversationTurn', () => {
  let getNewestUnprocessedMessageIdSpy: jest.SpyInstance
  let consoleLogSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    getNewestUnprocessedMessageIdSpy = jest
      .spyOn(SessionRepository, 'getNewestUnprocessedMessageId')
      .mockResolvedValue('wamid-active')
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.clearAllMocks()
    getNewestUnprocessedMessageIdSpy.mockRestore()
    consoleLogSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('exits with superseded_pre_ai and never calls the AI when a newer message is unprocessed', async () => {
    getNewestUnprocessedMessageIdSpy.mockResolvedValue('wamid-newer')
    const session = buildFakeSession()
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(session.beginTurn).not.toHaveBeenCalled()
    expect(session.processMessage).not.toHaveBeenCalled()
    expect(session.endTurn).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'superseded_pre_ai',
    })
  })

  it('treats no unprocessed messages left (null) as superseded_pre_ai too', async () => {
    getNewestUnprocessedMessageIdSpy.mockResolvedValue(null)
    const session = buildFakeSession()
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(session.processMessage).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'info: conversation turn outcome',
      expect.objectContaining({ outcome: 'superseded_pre_ai' })
    )
  })

  it('exits with error and never starts a turn when the in-memory session has no unprocessed messages (memory/DB desync)', async () => {
    const session = buildFakeSession()
    session.getUnprocessedMessagesArray.mockReturnValue([])
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await expect(processConversationTurn(payload)).resolves.toBeUndefined()

    expect(session.beginTurn).not.toHaveBeenCalled()
    expect(session.buildMergedUnprocessedMessage).not.toHaveBeenCalled()
    expect(session.processMessage).not.toHaveBeenCalled()
    expect(session.endTurn).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'error',
    })
  })

  it('happy path: wraps beginTurn/endTurn, merges and processes the message, logs completed', async () => {
    const processMessage = jest.fn().mockResolvedValue('completed')
    const session = buildFakeSession({ processMessage })
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(session.beginTurn).toHaveBeenCalledWith(payload.messageId)
    expect(session.buildMergedUnprocessedMessage).toHaveBeenCalled()
    expect(session.getUnprocessedMessagesArray).toHaveBeenCalled()
    expect(processMessage).toHaveBeenCalledWith(
      session.buildMergedUnprocessedMessage.mock.results[0].value,
      session.getUnprocessedMessagesArray.mock.results[0].value
    )
    expect(session.endTurn).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'completed',
    })
  })

  it('logs error and exits without throwing when the session cannot be resolved (client gone)', async () => {
    ;(Store.getInstance as jest.Mock).mockReturnValue({
      getWhatsAppClient: jest.fn().mockReturnValue(undefined),
    })
    const payload = buildPayload()

    await expect(processConversationTurn(payload)).resolves.toBeUndefined()

    expect(getNewestUnprocessedMessageIdSpy).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'error',
    })
  })

  it('logs error and exits without throwing when the session is resolvable but evicted', async () => {
    mockResolvedWhatsappClient(undefined)
    const payload = buildPayload()

    await expect(processConversationTurn(payload)).resolves.toBeUndefined()

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'info: conversation turn outcome',
      expect.objectContaining({ outcome: 'error' })
    )
  })

  it('does not double-log a discarded turn: Session.processMessage already logged it, so the processor stays silent on outcome but still ends the turn', async () => {
    const processMessage = jest.fn().mockResolvedValue('discarded_post_ai')
    const session = buildFakeSession({ processMessage })
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(session.endTurn).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      'info: conversation turn outcome',
      expect.anything()
    )
  })

  it('does not misreport a discarded turn as completed', async () => {
    const processMessage = jest.fn().mockResolvedValue('discarded_post_ai')
    const session = buildFakeSession({ processMessage })
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      'info: conversation turn outcome',
      expect.objectContaining({ outcome: 'completed' })
    )
  })

  it('logs error and still ends the turn when an unexpected exception is thrown mid-turn', async () => {
    const processMessage = jest
      .fn()
      .mockRejectedValue(new Error('should never reject, but guard anyway'))
    const session = buildFakeSession({ processMessage })
    mockResolvedWhatsappClient(session)
    const payload = buildPayload()

    await expect(processConversationTurn(payload)).resolves.toBeUndefined()

    expect(session.endTurn).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'error',
    })
  })
})

// ---------------------------------------------------------------------------
// Integration with the real Session/dispatchTurn seam (task 5.3, design D5):
// every test above stubs session.processMessage wholesale, so nothing proves
// the processor's real caller (Session.processMessage, unit-tested on its own
// in Session.spec.ts) actually reaches TurnDispatcher.dispatchTurn for a
// BOOKING session on a chatBot line, nor that a DiscardedTurnError raised from
// there surfaces as 'discarded_post_ai' with no fallback message once routed
// back through this processor. Line-mode/status gating itself is TurnDispatcher's
// own responsibility (covered by TurnDispatcher.spec.ts's matrix) — dispatchTurn
// is mocked here too, this only pins the seam between the two real modules.
// ---------------------------------------------------------------------------

describe('processConversationTurn — real Session.processMessage reaching dispatchTurn', () => {
  const dispatchTurnMock = dispatchTurn as jest.Mock
  let setProcessedMsgsSpy: jest.SpyInstance
  let consoleLogSpy: jest.SpyInstance

  function buildRealSession(message: WpMessage): Session {
    const session = new Session('chat-1')
    session.id = 'session-1'
    session.wp_client_id = 'wp-client-1'
    session.messages = new Map([[message.id, message]])
    session.chat = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      archive: jest.fn().mockResolvedValue(undefined),
    } as unknown as Session['chat']
    return session
  }

  function mockWhatsappClientWithSession(session: Session) {
    const getChatBot = jest.fn().mockReturnValue({
      getSessionById: jest.fn().mockReturnValue(session),
    })
    ;(Store.getInstance as jest.Mock).mockReturnValue({
      getWhatsAppClient: jest.fn().mockReturnValue({ getChatBot }),
    })
  }

  beforeEach(() => {
    dispatchTurnMock.mockReset()
    setProcessedMsgsSpy = jest
      .spyOn(SessionRepository, 'setProcessedMsgs')
      .mockResolvedValue(undefined)
    jest.spyOn(SessionRepository, 'getNewestUnprocessedMessageId').mockResolvedValue('wamid-active')
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reaches dispatchTurn with the BOOKING session on a chatBot-line turn and logs completed', async () => {
    const message = buildMergedMessage({ id: 'wamid-active' })
    const session = buildRealSession(message)
    expect(session.status).toBe(SessionStatuses.BOOKING)
    mockWhatsappClientWithSession(session)
    dispatchTurnMock.mockResolvedValue(undefined)
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(dispatchTurnMock).toHaveBeenCalledTimes(1)
    expect(dispatchTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1', status: SessionStatuses.BOOKING }),
      expect.objectContaining({ id: 'wamid-active' })
    )
    expect(setProcessedMsgsSpy).toHaveBeenCalledWith('session-1', [message])
    expect(consoleLogSpy).toHaveBeenCalledWith('info: conversation turn outcome', {
      wpClientId: payload.wpClientId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      outcome: 'completed',
    })
  })

  it('a DiscardedTurnError from dispatchTurn yields discarded_post_ai with no fallback message and no double log', async () => {
    const message = buildMergedMessage({ id: 'wamid-active' })
    const session = buildRealSession(message)
    mockWhatsappClientWithSession(session)
    dispatchTurnMock.mockRejectedValue(new DiscardedTurnError('superseded'))
    const payload = buildPayload()

    await processConversationTurn(payload)

    expect(setProcessedMsgsSpy).not.toHaveBeenCalled()
    expect(message.processed).toBe(false)
    expect(session.chat.sendMessage as jest.Mock).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'info: chatbot turn discarded post-AI',
      expect.objectContaining({ outcome: 'discarded_post_ai', reason: 'superseded' })
    )
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      'info: conversation turn outcome',
      expect.anything()
    )
  })
})
