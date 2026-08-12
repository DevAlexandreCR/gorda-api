import Session from '../Session'
import SessionRepository from '../../Repositories/SessionRepository'
import { WpMessage } from '../../Types/WpMessage'
import { MessageTypes } from '../../Services/whatsapp/constants/MessageTypes'
import { SessionStatuses } from '../../Types/SessionStatuses'
import { SessionInterface } from '../../Interfaces/SessionInterface'
import { DiscardedTurnError } from '../../Services/chatBot/turns/DiscardedTurnError'
import { ResponseContext } from '../../Services/chatBot/MessageStrategy/ResponseContext'
import { ResponseContract } from '../../Services/chatBot/MessageStrategy/ResponseContract'
import { enqueueConversationTurn } from '../../Services/chatBot/turns/ConversationTurnQueue'
import { WpMessageInterface } from '../../Services/whatsapp/interfaces/WpMessageInterface'
import config from '../../../config.js'
import { AskingForPlace } from '../../Services/chatBot/MessageStrategy/Responses/AskingForPlace'
import { PlaceInterface } from '../../Interfaces/PlaceInterface'

jest.mock('../../Services/chatBot/Messages', () => ({
  getSingleMessage: jest.fn(() => ({
    id: 'error-while-processing',
    name: 'Error While Processing',
    description: '',
    message: 'error-while-processing',
    enabled: true,
    interactive: null,
  })),
}))

jest.mock('../../Services/chatBot/turns/ConversationTurnQueue', () => ({
  enqueueConversationTurn: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<WpMessage> = {}): WpMessage {
  return {
    created_at: 1000,
    id: 'wamid-1',
    type: MessageTypes.TEXT,
    msg: 'hello',
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
    ...overrides,
  }
}

function makeSessionWithMessages(messages: WpMessage[]): Session {
  const session = new Session('chat-1')
  session.id = 'session-1'
  session.messages = new Map(messages.map((msg) => [msg.id, msg]))
  return session
}

// ---------------------------------------------------------------------------
// buildMergedUnprocessedMessage
// ---------------------------------------------------------------------------

describe('Session.buildMergedUnprocessedMessage', () => {
  it('joins text bodies with a single space in arrival order and bases fields on the newest message', () => {
    const first = makeMessage({ id: 'wamid-1', created_at: 1000, msg: 'hola' })
    const second = makeMessage({ id: 'wamid-2', created_at: 2000, msg: 'como estas' })
    const newest = makeMessage({ id: 'wamid-3', created_at: 3000, msg: 'todo bien?' })
    const session = makeSessionWithMessages([first, second, newest])

    const merged = session.buildMergedUnprocessedMessage()

    expect(merged.msg).toBe('hola como estas todo bien?')
    expect(merged.id).toBe(newest.id)
    expect(merged.created_at).toBe(newest.created_at)
    expect(merged.type).toBe(newest.type)
    expect(merged.processed).toBe(false)
    expect(merged.fromMe).toBe(false)
    expect(merged.location).toBeNull()
    expect(merged.interactive).toBeNull()
  })

  it('excludes already-processed messages from the merge', () => {
    const processed = makeMessage({ id: 'wamid-1', created_at: 1000, msg: 'old', processed: true })
    const unprocessed = makeMessage({ id: 'wamid-2', created_at: 2000, msg: 'new' })
    const session = makeSessionWithMessages([processed, unprocessed])

    const merged = session.buildMergedUnprocessedMessage()

    expect(merged.msg).toBe('new')
    expect(merged.id).toBe(unprocessed.id)
  })

  it('adopts LOCATION type/payload from any buffered message that carries a location', () => {
    const location = {
      name: 'Home',
      lat: 4.60971,
      lng: -74.08175,
    }
    const first = makeMessage({ id: 'wamid-1', created_at: 1000, msg: 'estoy aqui' })
    const locationMsg = makeMessage({
      id: 'wamid-2',
      created_at: 2000,
      type: MessageTypes.LOCATION,
      msg: '',
      location,
    })
    const third = makeMessage({ id: 'wamid-3', created_at: 3000, msg: 'listo' })
    const session = makeSessionWithMessages([first, locationMsg, third])

    const merged = session.buildMergedUnprocessedMessage()

    expect(merged.location).toEqual(location)
    expect(merged.type).toBe(MessageTypes.LOCATION)
    // Base fields (id/created_at) still come from the newest message, not the location one.
    expect(merged.id).toBe(third.id)
    expect(merged.created_at).toBe(third.created_at)
    // Text join is unaffected by the location override (current, preserved behavior).
    expect(merged.msg).toBe('estoy aqui  listo')
  })

  it('preserves interactiveReply/interactive from the newest message', () => {
    const first = makeMessage({ id: 'wamid-1', created_at: 1000, msg: 'hola' })
    const newest = makeMessage({
      id: 'wamid-2',
      created_at: 2000,
      msg: 'option_a',
      type: MessageTypes.INTERACTIVE,
      interactiveReply: { type: 'button_reply', button_reply: { id: 'option_a', title: 'Option A' } },
    })
    const session = makeSessionWithMessages([first, newest])

    const merged = session.buildMergedUnprocessedMessage()

    expect(merged.interactiveReply).toEqual(newest.interactiveReply)
    expect(merged.interactive).toBeNull()
    expect(merged.id).toBe(newest.id)
    expect(merged.type).toBe(newest.type)
  })
})

// ---------------------------------------------------------------------------
// addMsg: enqueue instead of scheduling processing (design D1/D5/D8, task 4.1)
// ---------------------------------------------------------------------------

function makeInboundMessage(overrides: Partial<WpMessageInterface> = {}): WpMessageInterface {
  return {
    id: 'wamid-raw-1',
    timestamp: 1000,
    type: MessageTypes.TEXT,
    from: 'chat-1',
    isStatus: false,
    body: 'hello',
    location: null,
    interactiveReply: null,
    getChat: jest.fn(),
    ...overrides,
  } as unknown as WpMessageInterface
}

describe('Session.addMsg', () => {
  let addMsgSpy: jest.SpyInstance
  const enqueueMock = enqueueConversationTurn as jest.Mock

  function makeSessionForAddMsg(): Session {
    const session = new Session('chat-1')
    session.id = 'session-1'
    session.setWpClientId('wp-client-1')
    return session
  }

  beforeEach(() => {
    enqueueMock.mockClear()
  })

  afterEach(() => {
    addMsgSpy.mockRestore()
  })

  it('text message: enqueues with CHATBOT_DEBOUNCE_MS delay and the wamid from SessionRepository.addMsg, not the raw inbound id', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValue({ created: true, id: 'stored-wamid-1' })
    const session = makeSessionForAddMsg()
    const inbound = makeInboundMessage({ id: 'wamid-raw-1', type: MessageTypes.TEXT })

    const result = await session.addMsg(inbound)

    expect(result).toEqual({ created: true, id: 'stored-wamid-1' })
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(
      {
        wpClientId: 'wp-client-1',
        sessionId: 'session-1',
        chatId: 'chat-1',
        // Must be the wamid SessionRepository.addMsg returned (messageRecord.messageId),
        // never the raw inbound id nor the auto-increment PK.
        messageId: 'stored-wamid-1',
      },
      config.CHATBOT_DEBOUNCE_MS
    )
  })

  it('location message: enqueues with delay 0', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValue({ created: true, id: 'stored-wamid-2' })
    const session = makeSessionForAddMsg()
    const inbound = makeInboundMessage({
      id: 'wamid-raw-2',
      type: MessageTypes.LOCATION,
      location: { name: 'Home', lat: '4.6', lng: '-74.08' } as never,
    })

    await session.addMsg(inbound)

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'stored-wamid-2' }),
      0
    )
  })

  it('interactive reply: enqueues with delay 0', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValue({ created: true, id: 'stored-wamid-3' })
    const session = makeSessionForAddMsg()
    const inbound = makeInboundMessage({
      id: 'wamid-raw-3',
      type: MessageTypes.INTERACTIVE,
      interactiveReply: { type: 'button_reply', button_reply: { id: 'option_a', title: 'Option A' } },
    })

    await session.addMsg(inbound)

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'stored-wamid-3' }),
      0
    )
  })

  it('duplicate message (not created): enqueues nothing', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValue({ created: false, id: 'stored-wamid-1' })
    const session = makeSessionForAddMsg()
    const inbound = makeInboundMessage()

    const result = await session.addMsg(inbound)

    expect(result).toEqual({ created: false, id: 'stored-wamid-1' })
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // spec scenario: "Location message after buffered texts" — the location turn
  // enqueues with delay 0 (design D5) and, once it runs, its merge (design D4)
  // must still carry the two buffered texts alongside the location.
  it('location after two buffered texts: enqueues delay 0, and the merged message carries the location plus the buffered text', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValueOnce({ created: true, id: 'wamid-1' })
      .mockResolvedValueOnce({ created: true, id: 'wamid-2' })
      .mockResolvedValueOnce({ created: true, id: 'wamid-3' })
    const session = makeSessionForAddMsg()

    await session.addMsg(makeInboundMessage({ id: 'raw-1', type: MessageTypes.TEXT, body: 'hola' }))
    await session.addMsg(
      makeInboundMessage({ id: 'raw-2', type: MessageTypes.TEXT, body: 'quiero un taxi' })
    )
    enqueueMock.mockClear()
    await session.addMsg(
      makeInboundMessage({
        id: 'raw-3',
        type: MessageTypes.LOCATION,
        location: { name: 'Home', lat: '4.6', lng: '-74.08' } as never,
      })
    )

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'wamid-3' }), 0)

    const merged = session.buildMergedUnprocessedMessage()
    expect(merged.type).toBe(MessageTypes.LOCATION)
    expect(merged.location).toEqual({ name: 'Home', lat: 4.6, lng: -74.08 })
    // Location messages persist with msg: '' (task 3.3's documented quirk): a
    // trailing location leaves a trailing space rather than a mid-string double
    // space. Current behavior, not "fixed" here.
    expect(merged.msg).toBe('hola quiero un taxi ')
  })

  // spec scenario: "Interactive reply after buffered texts" — the interactive
  // turn enqueues with delay 0 (design D5) and its merge must preserve
  // interactiveReply from the newest (interactive) message while still
  // carrying the buffered text.
  it('interactive reply after a buffered text: enqueues delay 0, and the merged message preserves interactiveReply alongside the buffered text', async () => {
    addMsgSpy = jest
      .spyOn(SessionRepository, 'addMsg')
      .mockResolvedValueOnce({ created: true, id: 'wamid-1' })
      .mockResolvedValueOnce({ created: true, id: 'wamid-2' })
    const session = makeSessionForAddMsg()
    const interactiveReply = {
      type: 'button_reply' as const,
      button_reply: { id: 'option_a', title: 'Option A' },
    }

    await session.addMsg(
      makeInboundMessage({ id: 'raw-1', type: MessageTypes.TEXT, body: 'quiero ir a' })
    )
    enqueueMock.mockClear()
    await session.addMsg(
      makeInboundMessage({ id: 'raw-2', type: MessageTypes.INTERACTIVE, interactiveReply })
    )

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'wamid-2' }), 0)

    const merged = session.buildMergedUnprocessedMessage()
    expect(merged.interactiveReply).toEqual(interactiveReply)
    expect(merged.type).toBe(MessageTypes.INTERACTIVE)
    expect(merged.msg).toBe('quiero ir a option_a')
  })
})

// ---------------------------------------------------------------------------
// enqueueBootSweepTurn (task 4.3, design D8): replaces syncMessages(true)'s
// boot-time reprocessing so restart-orphaned unprocessed messages still
// enqueue a turn instead of being silently dropped.
// ---------------------------------------------------------------------------

describe('Session.enqueueBootSweepTurn', () => {
  let getNewestUnprocessedMessageIdSpy: jest.SpyInstance
  const enqueueMock = enqueueConversationTurn as jest.Mock

  function makeSessionForSweep(): Session {
    const session = new Session('chat-1')
    session.id = 'session-1'
    session.setWpClientId('wp-client-1')
    return session
  }

  beforeEach(() => {
    enqueueMock.mockClear()
    getNewestUnprocessedMessageIdSpy = jest.spyOn(SessionRepository, 'getNewestUnprocessedMessageId')
  })

  afterEach(() => {
    getNewestUnprocessedMessageIdSpy.mockRestore()
  })

  it('session with unprocessed messages: enqueues delay 0 with the newest wamid', async () => {
    getNewestUnprocessedMessageIdSpy.mockResolvedValue('newest-wamid')
    const session = makeSessionForSweep()

    await session.enqueueBootSweepTurn()

    expect(getNewestUnprocessedMessageIdSpy).toHaveBeenCalledWith('session-1')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(
      {
        wpClientId: 'wp-client-1',
        sessionId: 'session-1',
        chatId: 'chat-1',
        messageId: 'newest-wamid',
      },
      0
    )
  })

  it('session with no unprocessed messages: enqueues nothing', async () => {
    getNewestUnprocessedMessageIdSpy.mockResolvedValue(null)
    const session = makeSessionForSweep()

    await session.enqueueBootSweepTurn()

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('a failing session does not throw, so the boot sweep can continue for other sessions', async () => {
    getNewestUnprocessedMessageIdSpy.mockRejectedValue(new Error('db unavailable'))
    const session = makeSessionForSweep()

    await expect(session.enqueueBootSweepTurn()).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Turn gate: beginTurn / endTurn / assertTurnStillValid (design D3)
// ---------------------------------------------------------------------------

function makeFreshSessionRecord(overrides: Partial<SessionInterface> = {}): SessionInterface {
  return {
    id: 'session-1',
    status: SessionStatuses.ASKING_FOR_PLACE,
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

describe('Session turn gate', () => {
  let getNewestUnprocessedMessageIdSpy: jest.SpyInstance
  let findSessionByIdSpy: jest.SpyInstance

  beforeEach(() => {
    getNewestUnprocessedMessageIdSpy = jest
      .spyOn(SessionRepository, 'getNewestUnprocessedMessageId')
      .mockResolvedValue('wamid-active')
    findSessionByIdSpy = jest
      .spyOn(SessionRepository, 'findSessionById')
      .mockResolvedValue(makeFreshSessionRecord())
  })

  afterEach(() => {
    getNewestUnprocessedMessageIdSpy.mockRestore()
    findSessionByIdSpy.mockRestore()
  })

  it('assertTurnStillValid is a safe no-op when no turn is active (legacy timer path)', async () => {
    const session = makeSessionWithMessages([])

    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()
    expect(getNewestUnprocessedMessageIdSpy).not.toHaveBeenCalled()
    expect(findSessionByIdSpy).not.toHaveBeenCalled()
  })

  it('resolves when the active turn is still the newest unprocessed message and the session is live', async () => {
    const session = makeSessionWithMessages([])
    session.beginTurn('wamid-active')

    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()
  })

  it('throws DiscardedTurnError with reason "superseded" when a newer message has arrived', async () => {
    getNewestUnprocessedMessageIdSpy.mockResolvedValue('wamid-newer')
    const session = makeSessionWithMessages([])
    session.beginTurn('wamid-active')

    await expect(session.assertTurnStillValid()).rejects.toThrow(DiscardedTurnError)
    await expect(session.assertTurnStillValid()).rejects.toMatchObject({ reason: 'superseded' })
  })

  it('throws DiscardedTurnError with reason "completed" when the session reached COMPLETED', async () => {
    findSessionByIdSpy.mockResolvedValue(
      makeFreshSessionRecord({ status: SessionStatuses.COMPLETED })
    )
    const session = makeSessionWithMessages([])
    session.beginTurn('wamid-active')

    await expect(session.assertTurnStillValid()).rejects.toMatchObject({ reason: 'completed' })
  })

  it('throws DiscardedTurnError with reason "support" when the session reached SUPPORT', async () => {
    findSessionByIdSpy.mockResolvedValue(
      makeFreshSessionRecord({ status: SessionStatuses.SUPPORT })
    )
    const session = makeSessionWithMessages([])
    session.beginTurn('wamid-active')

    await expect(session.assertTurnStillValid()).rejects.toMatchObject({ reason: 'support' })
  })

  it('is re-entrancy safe: a nested beginTurn/endTurn pair does not clobber or end the outer turn', async () => {
    const session = makeSessionWithMessages([])

    session.beginTurn('outer-msg')
    session.beginTurn('inner-msg')
    session.endTurn()

    // Outer turn ("outer-msg") is still active: the newest unprocessed message
    // matches it, so no supersede should be reported.
    getNewestUnprocessedMessageIdSpy.mockResolvedValue('outer-msg')
    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()

    // If the inner call had clobbered the context to "inner-msg", this would
    // incorrectly report supersede even though the outer turn is still valid.
    getNewestUnprocessedMessageIdSpy.mockResolvedValue('outer-msg')
    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()

    session.endTurn()

    // Now the outer turn has ended too: assertTurnStillValid is a no-op again.
    getNewestUnprocessedMessageIdSpy.mockClear()
    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()
    expect(getNewestUnprocessedMessageIdSpy).not.toHaveBeenCalled()
  })

  it('an extra endTurn beyond the active depth is a no-op and does not go negative', async () => {
    const session = makeSessionWithMessages([])

    session.endTurn()
    session.beginTurn('wamid-active')

    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()

    session.endTurn()
    getNewestUnprocessedMessageIdSpy.mockClear()
    await expect(session.assertTurnStillValid()).resolves.toBeUndefined()
    expect(getNewestUnprocessedMessageIdSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// processMessage: catch/processed-marking control flow (design D3 points 3-4)
// ---------------------------------------------------------------------------

describe('Session.processMessage', () => {
  let setProcessedMsgsSpy: jest.SpyInstance
  let getResponseSpy: jest.SpyInstance
  let sendMessageMock: jest.Mock
  let consoleLogSpy: jest.SpyInstance

  function makeFakeHandler(processMessageImpl: () => Promise<void>): ResponseContract {
    return {
      supportMessage: () => true,
      processMessage: jest.fn(processMessageImpl),
    } as unknown as ResponseContract
  }

  function makeSessionForProcessing(unprocessed: WpMessage[]): Session {
    const session = makeSessionWithMessages(unprocessed)
    sendMessageMock = jest.fn().mockResolvedValue(undefined)
    session.chat = {
      sendMessage: sendMessageMock,
      archive: jest.fn().mockResolvedValue(undefined),
    } as unknown as Session['chat']
    return session
  }

  beforeEach(() => {
    setProcessedMsgsSpy = jest.spyOn(SessionRepository, 'setProcessedMsgs').mockResolvedValue(undefined)
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    setProcessedMsgsSpy.mockRestore()
    getResponseSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('success path: marks the batch processed and sends no fallback', async () => {
    const msg = makeMessage()
    const session = makeSessionForProcessing([msg])
    getResponseSpy = jest
      .spyOn(ResponseContext, 'getResponse')
      .mockReturnValue(makeFakeHandler(() => Promise.resolve()))

    await session.processMessage(msg, [msg])

    expect(setProcessedMsgsSpy).toHaveBeenCalledWith(session.id, [msg])
    expect(msg.processed).toBe(true)
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('DiscardedTurnError: sends no fallback, is not reported as an error, and leaves messages unprocessed', async () => {
    const msg = makeMessage()
    const session = makeSessionForProcessing([msg])
    getResponseSpy = jest
      .spyOn(ResponseContext, 'getResponse')
      .mockReturnValue(makeFakeHandler(() => Promise.reject(new DiscardedTurnError('superseded'))))

    await session.processMessage(msg, [msg])

    expect(setProcessedMsgsSpy).not.toHaveBeenCalled()
    expect(msg.processed).toBe(false)
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'info: chatbot turn discarded post-AI',
      expect.objectContaining({
        outcome: 'discarded_post_ai',
        reason: 'superseded',
        messageId: msg.id,
        sessionId: session.id,
      })
    )
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      'error while processing message',
      expect.anything()
    )
  })

  // spec scenario: "Operator took over during AI processing" / "Customer wrote
  // during AI processing" — DiscardedTurnError's post-AI behavior (no fallback,
  // not an error) must hold regardless of *why* the gate discarded the turn:
  // COMPLETED and SUPPORT, not just supersede.
  it.each<'completed' | 'support'>(['completed', 'support'])(
    'DiscardedTurnError with reason "%s": sends no fallback, is not reported as an error, and leaves messages unprocessed',
    async (reason) => {
      const msg = makeMessage()
      const session = makeSessionForProcessing([msg])
      getResponseSpy = jest
        .spyOn(ResponseContext, 'getResponse')
        .mockReturnValue(makeFakeHandler(() => Promise.reject(new DiscardedTurnError(reason))))

      await session.processMessage(msg, [msg])

      expect(setProcessedMsgsSpy).not.toHaveBeenCalled()
      expect(msg.processed).toBe(false)
      expect(sendMessageMock).not.toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'info: chatbot turn discarded post-AI',
        expect.objectContaining({ outcome: 'discarded_post_ai', reason })
      )
    }
  )

  it('generic error: still sends the fallback and still marks the batch processed (today\'s behavior preserved)', async () => {
    const msg = makeMessage()
    const session = makeSessionForProcessing([msg])
    getResponseSpy = jest
      .spyOn(ResponseContext, 'getResponse')
      .mockReturnValue(makeFakeHandler(() => Promise.reject(new Error('boom'))))

    await session.processMessage(msg, [msg])

    expect(setProcessedMsgsSpy).toHaveBeenCalledWith(session.id, [msg])
    expect(msg.processed).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'error while processing message',
      expect.objectContaining({ error: 'boom' })
    )
  })
})

// ---------------------------------------------------------------------------
// Sliding window integration (spec: "Last message wins with merged context"):
// three buffered texts must produce exactly one AI turn, whose input is all
// three merged in arrival order, after which all three are marked processed.
// Exercises buildMergedUnprocessedMessage + processMessage together, the same
// pairing ConversationTurnProcessor.processConversationTurn (task 3.6) runs
// for the winning (newest) message's job.
// ---------------------------------------------------------------------------

describe('Session sliding window: three buffered texts merge into exactly one AI turn', () => {
  let setProcessedMsgsSpy: jest.SpyInstance
  let getResponseSpy: jest.SpyInstance
  let sendMessageMock: jest.Mock

  afterEach(() => {
    setProcessedMsgsSpy.mockRestore()
    getResponseSpy.mockRestore()
  })

  it('runs one AI turn with all three texts merged, then marks all three processed', async () => {
    setProcessedMsgsSpy = jest.spyOn(SessionRepository, 'setProcessedMsgs').mockResolvedValue(undefined)

    const first = makeMessage({ id: 'wamid-1', created_at: 1000, msg: 'hola' })
    const second = makeMessage({ id: 'wamid-2', created_at: 2000, msg: 'quiero un taxi' })
    const third = makeMessage({ id: 'wamid-3', created_at: 3000, msg: 'estoy en el centro' })
    const session = makeSessionWithMessages([first, second, third])
    sendMessageMock = jest.fn().mockResolvedValue(undefined)
    session.chat = {
      sendMessage: sendMessageMock,
      archive: jest.fn().mockResolvedValue(undefined),
    } as unknown as Session['chat']

    const handlerProcessMessage = jest.fn().mockResolvedValue(undefined)
    getResponseSpy = jest.spyOn(ResponseContext, 'getResponse').mockReturnValue({
      supportMessage: () => true,
      processMessage: handlerProcessMessage,
    } as unknown as ResponseContract)

    // Mirrors what the third (newest) message's turn job does when it wakes:
    // merge the buffered batch, then run the merged message through the
    // strategy pipeline (design D4).
    const merged = session.buildMergedUnprocessedMessage()
    const unprocessed = session.getUnprocessedMessagesArray()
    const outcome = await session.processMessage(merged, unprocessed)

    // Exactly one AI turn — the two older messages' own jobs must never reach
    // this call (they are superseded pre-AI, covered separately in
    // ConversationTurnProcessor.spec.ts); this test only asserts the winning
    // turn's single call and its merged content.
    expect(handlerProcessMessage).toHaveBeenCalledTimes(1)
    const [aiInputMessage] = handlerProcessMessage.mock.calls[0]
    expect(aiInputMessage.msg).toBe('hola quiero un taxi estoy en el centro')
    expect(outcome).toBe('completed')

    expect(setProcessedMsgsSpy).toHaveBeenCalledWith(session.id, [first, second, third])
    expect(first.processed).toBe(true)
    expect(second.processed).toBe(true)
    expect(third.processed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AskingForPlace's nested `this.session.processMessage(message, [])` call
// (AskingForPlace.ts:82, the "session.place already set, message doesn't
// match either place-collection branch" fallback) must not corrupt the outer
// turn context (design D3's counter-based beginTurn/endTurn — task 3.4/3.6).
// Uses the REAL Session (unlike AskingForPlace.spec.ts, which mocks Session
// entirely to dodge the Session<->ResponseContext<->strategies import cycle)
// because the assertion is on Session's own private turn bookkeeping.
// ---------------------------------------------------------------------------

describe('AskingForPlace nested session.processMessage: outer turn context integrity', () => {
  let setProcessedMsgsSpy: jest.SpyInstance
  let updateStatusSpy: jest.SpyInstance
  let getResponseSpy: jest.SpyInstance
  let nestedHandlerProcessMessage: jest.Mock

  beforeEach(() => {
    setProcessedMsgsSpy = jest.spyOn(SessionRepository, 'setProcessedMsgs').mockResolvedValue(undefined)
    updateStatusSpy = jest.spyOn(SessionRepository, 'updateStatus').mockResolvedValue(undefined as never)
    // The nested Session.processMessage call dispatches through
    // ResponseContext.getResponse again, based on the just-updated status.
    // Stub it so this test stays scoped to turn-context bookkeeping instead of
    // also exercising whatever real strategy that post-transition status maps to.
    nestedHandlerProcessMessage = jest.fn().mockResolvedValue(undefined)
    getResponseSpy = jest.spyOn(ResponseContext, 'getResponse').mockReturnValue({
      supportMessage: () => true,
      processMessage: nestedHandlerProcessMessage,
    } as unknown as ResponseContract)
  })

  afterEach(() => {
    setProcessedMsgsSpy.mockRestore()
    updateStatusSpy.mockRestore()
    getResponseSpy.mockRestore()
  })

  it('keeps the outer turnMessageId/turnDepth intact through the nested call, and a single endTurn tears it down fully', async () => {
    const session = new Session('chat-1')
    session.id = 'session-1'
    session.setWpClientId('wp-client-1')
    session.status = SessionStatuses.ASKING_FOR_PLACE
    session.place = {
      id: 'place-1',
      name: 'Barrio Centro',
      lat: 2.44,
      lng: -76.6,
      location: null,
      cityId: 'popayan',
    } as PlaceInterface

    const strategy = new AskingForPlace(session)
    const message = makeMessage({ id: 'wamid-outer', msg: 'algo mas' })

    // Simulate ConversationTurnProcessor.processConversationTurn's beginTurn
    // (task 3.6): this is the OUTER turn context.
    session.beginTurn('outer-wamid')
    expect(session['turnDepth']).toBe(1)
    expect(session['turnMessageId']).toBe('outer-wamid')

    const processMessageSpy = jest.spyOn(session, 'processMessage')

    // Hits AskingForPlace's fallback branch (place set, name !== LOCATION_NO_NAME):
    // awaits setStatus, then fires session.processMessage(message, []) WITHOUT
    // awaiting it — existing fire-and-forget behavior (AskingForPlace.ts:82),
    // not something this test changes.
    await strategy.processMessage(message)

    expect(updateStatusSpy).toHaveBeenCalledTimes(1)
    expect(session.status).toBe(SessionStatuses.ASKING_FOR_COMMENT)
    expect(processMessageSpy).toHaveBeenCalledTimes(1)
    const [nestedMessageArg, nestedUnprocessedArg] = processMessageSpy.mock.calls[0]
    expect(nestedMessageArg).toBe(message)
    expect(nestedUnprocessedArg).toEqual([])

    // Capture and await the nested call's own promise so its work is fully
    // settled before asserting on the context it observed.
    await processMessageSpy.mock.results[0].value

    // Proof the nested dispatch actually ran, using the post-transition status:
    expect(getResponseSpy).toHaveBeenCalledWith(SessionStatuses.ASKING_FOR_COMMENT, session)
    expect(nestedHandlerProcessMessage).toHaveBeenCalledTimes(1)

    // The depth counter is untouched by any of this: AskingForPlace never
    // calls session.beginTurn again for this branch, so depth stays exactly 1
    // and the active messageId stays the OUTER one throughout the nested call.
    expect(session['turnDepth']).toBe(1)
    expect(session['turnMessageId']).toBe('outer-wamid')

    // The nested processMessage's own .then() marks its (empty) batch processed.
    expect(setProcessedMsgsSpy).toHaveBeenCalledWith('session-1', [])

    // Simulate ConversationTurnProcessor's finally block: exactly one endTurn
    // call for the one beginTurn call it made. Must fully clear the context —
    // not left stuck at depth 1, and not cleared prematurely mid-flight either.
    session.endTurn()
    expect(session['turnDepth']).toBe(0)
    expect(session['turnMessageId']).toBeNull()
  })
})
