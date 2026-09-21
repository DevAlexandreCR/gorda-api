jest.mock('../../../../Models/Session', () => ({
  __esModule: true,
  default: { STATUS_SUPPORT: 'SUPPORT' },
}))

// Same stub pattern as AgentExecutor.spec.ts/DeterministicHandlers.spec.ts: assert only
// on which catalog id was requested, not on Messages/Store's own resolution.
jest.mock('../../Messages', () => ({
  getSingleMessage: jest.fn((id: string) => ({
    id,
    name: id,
    description: '',
    message: id,
    enabled: true,
    interactive: null,
  })),
}))

const mockBuildAgentContext = jest.fn()
const mockBuildAgentInput = jest.fn()
jest.mock('../AgentContextBuilder', () => ({
  buildAgentContext: (...args: unknown[]) => mockBuildAgentContext(...args),
  buildAgentInput: (...args: unknown[]) => mockBuildAgentInput(...args),
}))

const mockToolsForTurn = jest.fn()
const mockExecuteSearchPlace = jest.fn()
jest.mock('../AgentTools', () => {
  const actual = jest.requireActual('../AgentTools')
  return {
    ...actual,
    toolsForTurn: (...args: unknown[]) => mockToolsForTurn(...args),
    executeSearchPlace: (...args: unknown[]) => mockExecuteSearchPlace(...args),
  }
})

const mockValidateAgentActions = jest.fn()
jest.mock('../AgentValidator', () => ({
  validateAgentActions: (...args: unknown[]) => mockValidateAgentActions(...args),
}))

const mockExecuteAgentActions = jest.fn()
const mockStorePendingPin = jest.fn()
jest.mock('../AgentExecutor', () => ({
  executeAgentActions: (...args: unknown[]) => mockExecuteAgentActions(...args),
  storePendingPin: (...args: unknown[]) => mockStorePendingPin(...args),
}))

// Real-executor mocks (used by exactly one test below, via jest.requireActual('../
// AgentExecutor'), to prove the candidate-list gate against AgentExecutor's genuine
// set_place no-op behavior instead of a hand-mocked `executed` result). Mirrors the
// mocking AgentExecutor.spec.ts uses for the same module, so the real
// executeAgentActions loads without pulling in Sequelize models/repositories.
const mockFindPlaceById = jest.fn()
jest.mock('../../../../Container/Container', () => ({
  __esModule: true,
  default: { getPlaceRepository: jest.fn(() => ({ findById: mockFindPlaceById })) },
}))
jest.mock('../../../store/Store', () => ({
  Store: { getInstance: jest.fn(() => ({ findCityById: jest.fn(), findClientById: jest.fn(), createClient: jest.fn() })) },
}))
jest.mock('../../ServiceBooking', () => ({
  bookService: jest.fn(),
}))
jest.mock('../../deterministic/DeterministicHandlers', () => ({
  cancelService: jest.fn(),
  insistService: jest.fn(),
}))

const mockSendGatedMessage = jest.fn()
jest.mock('../../TurnSupport', () => ({
  sendGatedMessage: (...args: unknown[]) => mockSendGatedMessage(...args),
}))

import { runAgentTurn } from '../AgentTurn'
import { DiscardedTurnError } from '../../turns/DiscardedTurnError'
import { OpenAIResponsesError, OpenAIResponsesResult } from '../OpenAIResponsesClient'
import { AgentOutput } from '../AgentPrompt'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { MessagesEnum } from '../../MessagesEnum'
import { AgentContext } from '../AgentContextBuilder'

function buildMessage(overrides: Partial<WpMessage> = {}): WpMessage {
  return {
    created_at: 0,
    id: 'msg-1',
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

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    wp_client_id: 'wpclient-1',
    chat_id: '573001234567@c.us',
    status: 'BOOKING',
    place: null,
    state: { comment: null, pending_candidates: [], pending_pin: null, awaiting: null },
    setStatus: jest.fn().mockResolvedValue(undefined),
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    client: null,
    session: {
      status: 'BOOKING',
      place: null,
      comment: null,
      pending_candidates: [],
      pending_pin_awaiting_reference: false,
      is_first_reply: false,
    },
    service: null,
    line: { company_name: 'Gorda', pqr_number: '123', city: 'Popayán' },
    current_message: { text: 'hola', location: null, interactive_reply_id: null },
    system_events: [],
    ...overrides,
  }
}

function finalResult(output: AgentOutput): OpenAIResponsesResult<AgentOutput> {
  return { type: 'final', data: output, rawOutput: [] }
}

function functionCallsResult(callId: string, name: string): OpenAIResponsesResult<AgentOutput> {
  return {
    type: 'function_calls',
    calls: [{ callId, name, arguments: { query: 'campanario' } }],
    rawOutput: [{ type: 'function_call', call_id: callId, name }],
  }
}

function buildClient() {
  return {
    createResponse: jest.fn(),
    buildFollowUpInput: jest.fn((previous: unknown[], raw: unknown[], outputs: unknown[]) => [
      ...(previous as unknown[]),
      ...(raw as unknown[]),
      ...(outputs as unknown[]),
    ]),
  }
}

describe('runAgentTurn (chatbot-agent-conversation, task 2.8)', () => {
  let consoleLogSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    mockBuildAgentContext.mockResolvedValue({ context: buildContext(), history: [] })
    mockBuildAgentInput.mockReturnValue([])
    mockToolsForTurn.mockReturnValue([
      { type: 'function', name: 'search_place', description: 'd', parameters: {}, strict: true },
    ])
    mockExecuteSearchPlace.mockResolvedValue({ candidates: [], hasStrongCandidate: false })
    mockSendGatedMessage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('happy path: executes accepted actions and sends the reply once', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockResolvedValueOnce(
      finalResult({
        reply: 'Claro, ¿me confirmas el lugar?',
        actions: [{ type: 'set_comment', text: 'x' }],
      })
    )
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'set_comment', text: 'x' }],
      rejected: [],
    })
    mockExecuteAgentActions.mockResolvedValueOnce({
      executed: ['set_comment'],
      suppressReply: false,
    })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    expect(mockExecuteAgentActions).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].message).toBe('Claro, ¿me confirmas el lugar?')
    expect(outcome).toEqual({
      fallback: false,
      toolCalls: 0,
      actions: ['set_comment'],
      rejected: [],
      latencyMs: expect.any(Number),
      model: 'gpt-test',
    })

    // Task 2.9 / design D9: exactly one structured `agent_turn` log line per turn.
    const agentTurnLogs = consoleLogSpy.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).event === 'agent_turn'
    )
    expect(agentTurnLogs).toHaveLength(1)
    expect(JSON.parse(agentTurnLogs[0][0] as string)).toEqual({
      event: 'agent_turn',
      wpClientId: 'wpclient-1',
      sessionId: 'session-1',
      messageId: 'msg-1',
      model: 'gpt-test',
      toolCalls: 0,
      actions: ['set_comment'],
      rejected: [],
      latencyMs: expect.any(Number),
      fallback: false,
    })
  })

  it('create_service: suppresses the reply even though the model returned reply text (spec: "No duplicate confirmation", design D7)', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockResolvedValueOnce(
      finalResult({
        reply: '¡Listo, ya pedí tu taxi!',
        actions: [{ type: 'create_service' }],
      })
    )
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'create_service' }],
      rejected: [],
    })
    mockExecuteAgentActions.mockResolvedValueOnce({
      executed: ['create_service'],
      suppressReply: true,
    })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    // The reply is discarded entirely: only the SERVICE_CREATED catalog message (sent
    // by WhatsAppClient.onNewService from the RTDB `new` notification) reaches the
    // customer for this turn.
    expect(mockSendGatedMessage).not.toHaveBeenCalled()
    expect(outcome.actions).toEqual(['create_service'])
    expect(outcome.fallback).toBe(false)
  })

  it('budget exhaustion: refuses the call once AGENT_MAX_TOOL_CALLS is spent and forces a toolChoice:"none" finalize', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(functionCallsResult('c2', 'search_place'))
      .mockResolvedValueOnce(functionCallsResult('c3', 'search_place'))
      .mockResolvedValueOnce(finalResult({ reply: 'Encontré el lugar', actions: [] }))
    mockValidateAgentActions.mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      maxToolCalls: 3,
      model: 'gpt-test',
    })

    expect(client.createResponse).toHaveBeenCalledTimes(4)
    expect(mockExecuteSearchPlace).toHaveBeenCalledTimes(3)
    // The 4th (forced-finalize) call must not let the model call a tool again.
    expect(client.createResponse.mock.calls[3][0]).toMatchObject({ toolChoice: 'none' })
    expect(client.createResponse.mock.calls[0][0].toolChoice).toBeUndefined()
    expect(outcome.fallback).toBe(false)
    expect(outcome.toolCalls).toBe(3)
  })

  it('rejected-action regeneration: a hallucinated place id discards the first output and only the second is sent/executed', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(
        finalResult({
          reply: 'Listo, en Campanario abc123',
          actions: [{ type: 'set_place', placeId: 'abc123' }],
        })
      )
      .mockResolvedValueOnce(
        finalResult({
          reply: 'Perfecto, Campanario confirmado',
          actions: [{ type: 'set_place', placeId: 'p1' }],
        })
      )
    mockValidateAgentActions
      .mockReturnValueOnce({
        accepted: [],
        rejected: [{ action: 'set_place("abc123")', reason: 'not returned by search_place' }],
      })
      .mockReturnValueOnce({ accepted: [{ type: 'set_place', placeId: 'p1' }], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: ['set_place'], suppressReply: false })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    expect(client.createResponse).toHaveBeenCalledTimes(2)
    expect(mockBuildAgentContext).toHaveBeenCalledTimes(2)
    expect(mockBuildAgentContext.mock.calls[1][2]).toEqual({
      systemEvents: [
        {
          type: 'action_rejected',
          rejections: [{ action: 'set_place("abc123")', reason: 'not returned by search_place' }],
        },
      ],
    })
    expect(mockExecuteAgentActions).toHaveBeenCalledTimes(1)
    expect(mockExecuteAgentActions.mock.calls[0][1]).toEqual([{ type: 'set_place', placeId: 'p1' }])
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].message).toBe('Perfecto, Campanario confirmado')
    expect(outcome.fallback).toBe(false)
    expect(outcome.rejected).toEqual([
      { action: 'set_place("abc123")', reason: 'not returned by search_place' },
    ])
  })

  it('rejected-action regeneration: create_service without a place is discarded, retried once, then executed', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(
        finalResult({ reply: '¡Listo, ya pedí tu taxi!', actions: [{ type: 'create_service' }] })
      )
      .mockResolvedValueOnce(finalResult({ reply: 'Necesito el lugar primero', actions: [] }))
    mockValidateAgentActions
      .mockReturnValueOnce({
        accepted: [],
        rejected: [
          { action: 'create_service', reason: 'cannot create a service: no confirmed place' },
        ],
      })
      .mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    expect(client.createResponse).toHaveBeenCalledTimes(2)
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].message).toBe('Necesito el lugar primero')
    expect(outcome.fallback).toBe(false)
  })

  it('second failure: still invalid after the one regeneration sends ERROR_WHILE_PROCESSING exactly once and moves to SUPPORT', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(finalResult({ reply: 'r1', actions: [{ type: 'create_service' }] }))
      .mockResolvedValueOnce(finalResult({ reply: 'r2', actions: [{ type: 'create_service' }] }))
    mockValidateAgentActions
      .mockReturnValueOnce({
        accepted: [],
        rejected: [{ action: 'create_service', reason: 'no place' }],
      })
      .mockReturnValueOnce({
        accepted: [],
        rejected: [{ action: 'create_service', reason: 'no place' }],
      })

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    expect(mockExecuteAgentActions).not.toHaveBeenCalled()
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].id).toBe(MessagesEnum.ERROR_WHILE_PROCESSING)
    expect(session.setStatus).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledWith('SUPPORT')
    expect(outcome).toEqual({
      fallback: true,
      toolCalls: 0,
      actions: [],
      rejected: [
        { action: 'create_service', reason: 'no place' },
        { action: 'create_service', reason: 'no place' },
      ],
      latencyMs: expect.any(Number),
      model: 'gpt-test',
    })

    // Task 2.9 / design D9: the fallback path also logs exactly once, with fallback: true.
    const agentTurnLogs = consoleLogSpy.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).event === 'agent_turn'
    )
    expect(agentTurnLogs).toHaveLength(1)
    expect(JSON.parse(agentTurnLogs[0][0] as string)).toMatchObject({
      event: 'agent_turn',
      wpClientId: 'wpclient-1',
      sessionId: 'session-1',
      messageId: 'msg-1',
      fallback: true,
      actions: [],
    })
  })

  it('model outage: the client rejecting sends ERROR_WHILE_PROCESSING exactly once and moves to SUPPORT', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockRejectedValueOnce(
      new OpenAIResponsesError('OpenAI Responses API call failed')
    )

    const outcome = await runAgentTurn(session as any, message, {
      client: client as any,
      model: 'gpt-test',
    })

    expect(mockExecuteAgentActions).not.toHaveBeenCalled()
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].id).toBe(MessagesEnum.ERROR_WHILE_PROCESSING)
    expect(session.setStatus).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledWith('SUPPORT')
    expect(outcome.fallback).toBe(true)
  })

  it('gate discard: a DiscardedTurnError from the turn gate propagates untouched with no executor call, no send and no fallback', async () => {
    const session = buildSession({
      assertTurnStillValid: jest.fn().mockRejectedValue(new DiscardedTurnError('superseded')),
    })
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockResolvedValueOnce(
      finalResult({ reply: 'ok', actions: [{ type: 'set_comment', text: 'x' }] })
    )
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'set_comment', text: 'x' }],
      rejected: [],
    })

    await expect(
      runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })
    ).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(mockExecuteAgentActions).not.toHaveBeenCalled()
    expect(mockSendGatedMessage).not.toHaveBeenCalled()
    expect(session.setStatus).not.toHaveBeenCalled()

    // Task 2.9 / design D9: a gate discard is silent — no `agent_turn` log at all.
    const agentTurnLogs = consoleLogSpy.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).event === 'agent_turn'
    )
    expect(agentTurnLogs).toHaveLength(0)
  })

  // Task 5.3 (design D9, spec wp-send-failure-resilience "Turn-level handling owns the
  // failure"): executeAgentActions calls ctx.sendMessage (TurnSupport.sendGatedMessage)
  // directly with no internal try/catch of its own (e.g. applySetPlaceFromLocation,
  // applyCreateService/bookService, insistService), so a delivery failure surfaces as a
  // rejection of the executeAgentActions promise itself — exactly what mocking
  // executeAgentActions to reject reproduces here. That rejection must land in
  // AgentTurn's own try/catch (not escape as an unhandled rejection) and end the turn
  // through sendFallbackOnce, the same owned path a model-outage or validation failure
  // uses.
  it('executor send failure: a delivery rejection from executeAgentActions ends the turn through the owned fallback with no unhandled rejection', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockResolvedValueOnce(
      finalResult({
        reply: '¡Listo, ya pedí tu taxi!',
        actions: [{ type: 'create_service' }],
      })
    )
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'create_service' }],
      rejected: [],
    })
    const deliveryError = new Error('line disconnected')
    mockExecuteAgentActions.mockRejectedValueOnce(deliveryError)

    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)

    let outcome: Awaited<ReturnType<typeof runAgentTurn>>
    try {
      outcome = await runAgentTurn(session as any, message, {
        client: client as any,
        model: 'gpt-test',
      })
      // Give any stray unhandled rejection a chance to surface before asserting.
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(unhandledRejections).toEqual([])
    expect(outcome).toEqual({
      fallback: true,
      toolCalls: 0,
      actions: [],
      rejected: [],
      latencyMs: expect.any(Number),
      model: 'gpt-test',
    })
    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].id).toBe(MessagesEnum.ERROR_WHILE_PROCESSING)
    expect(session.setStatus).toHaveBeenCalledTimes(1)
    expect(session.setStatus).toHaveBeenCalledWith('SUPPORT')

    // Task 2.9 / design D9: the fallback path still logs exactly once, with fallback: true.
    const agentTurnLogs = consoleLogSpy.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).event === 'agent_turn'
    )
    expect(agentTurnLogs).toHaveLength(1)
    expect(JSON.parse(agentTurnLogs[0][0] as string)).toMatchObject({
      event: 'agent_turn',
      fallback: true,
      actions: [],
    })
  })
})

// Render search_place candidates as a selectable list instead of leaving the model to
// enumerate them in prose (chatbot-agent-conversation follow-up). These tests drive the
// same mocked runAgentTurn harness as above; executeSearchPlace is mocked per-call so a
// call can be asserted to have "genuinely searched and returned candidates" independent
// of the real AgentTools/ledger persistence (covered separately by AgentTools' own tests).
describe('runAgentTurn: candidate list attachment (chatbot-agent-conversation follow-up)', () => {
  let consoleLogSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    mockBuildAgentContext.mockResolvedValue({ context: buildContext(), history: [] })
    mockBuildAgentInput.mockReturnValue([])
    mockToolsForTurn.mockReturnValue([
      { type: 'function', name: 'search_place', description: 'd', parameters: {}, strict: true },
    ])
    mockExecuteSearchPlace.mockResolvedValue({ candidates: [], hasStrongCandidate: false })
    mockSendGatedMessage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('attaches a list built from the last search_place call\'s candidates when no place was set this turn', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({ reply: 'Encontré varios puntos, ¿en cuál te recogemos?', actions: [] })
      )
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [
        { id: 'p1', name: 'Studio F Campanario', score: 1 },
        { id: 'p2', name: 'CLARO CAMPANARIO', score: 1 },
      ],
      hasStrongCandidate: false,
    })
    mockValidateAgentActions.mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    const sent = mockSendGatedMessage.mock.calls[0][1]
    expect(sent.interactive.type).toBe('list')
    expect(sent.interactive.body).toEqual({
      text: 'Encontré varios puntos, ¿en cuál te recogemos?',
    })
    expect(sent.interactive.action.sections[0].rows).toEqual([
      { id: 'p1', title: 'Studio F Campanario' },
      { id: 'p2', title: 'CLARO CAMPANARIO' },
      { id: 'none_of_the_above', title: 'Ninguno de estos' },
    ])
  })

  it('does not attach a list when a set_place action actually executed', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({
          reply: 'Perfecto, confirmado en Campanario',
          actions: [{ type: 'set_place', placeId: 'p1' }],
        })
      )
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [{ id: 'p1', name: 'Studio F Campanario', score: 1 }],
      hasStrongCandidate: true,
    })
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'set_place', placeId: 'p1' }],
      rejected: [],
    })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: ['set_place'], suppressReply: false })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].interactive).toBeNull()
  })

  it('does not attach a list when set_place_from_location actually executed, even if search_place also ran this turn', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({
          reply: 'Listo, ubicado',
          actions: [{ type: 'set_place_from_location', reference: 'frente al parque' }],
        })
      )
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [{ id: 'p1', name: 'Studio F Campanario', score: 1 }],
      hasStrongCandidate: false,
    })
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'set_place_from_location', reference: 'frente al parque' }],
      rejected: [],
    })
    mockExecuteAgentActions.mockResolvedValueOnce({
      executed: ['set_place_from_location'],
      suppressReply: false,
    })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].interactive).toBeNull()
  })

  it('does not send anything (and therefore no list) when the reply is suppressed (create_service turn), even if search_place ran', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({ reply: '¡Listo, ya pedí tu taxi!', actions: [{ type: 'create_service' }] })
      )
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [{ id: 'p1', name: 'A', score: 1 }],
      hasStrongCandidate: false,
    })
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'create_service' }],
      rejected: [],
    })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: ['create_service'], suppressReply: true })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).not.toHaveBeenCalled()
  })

  it('does not send anything (and therefore no list) when the reply text is empty, even if search_place ran', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(finalResult({ reply: '   ', actions: [] }))
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [{ id: 'p1', name: 'A', score: 1 }],
      hasStrongCandidate: false,
    })
    mockValidateAgentActions.mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).not.toHaveBeenCalled()
  })

  it('does not attach a list when no search_place ran this turn', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse.mockResolvedValueOnce(
      finalResult({ reply: 'Hola, ¿en qué lugar te recogemos?', actions: [] })
    )
    mockValidateAgentActions.mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGatedMessage.mock.calls[0][1].interactive).toBeNull()
  })

  // Gate correctness (design intent): the reply-send point must read AgentExecutor's
  // `result.executed` — what genuinely ran — not `validation.accepted`. applySetPlace
  // can silently no-op when PlaceRepository.findById misses a validated id
  // ("AgentExecutor: set_place id not found in repository", AgentExecutor.ts), and the
  // customer must still get a usable list in that case.
  it('attaches a list when set_place was accepted by the validator but no-opped in the executor (executed stays empty)', async () => {
    const session = buildSession()
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({
          reply: 'Perfecto, confirmado',
          actions: [{ type: 'set_place', placeId: 'p1' }],
        })
      )
    mockExecuteSearchPlace.mockResolvedValueOnce({
      candidates: [{ id: 'p1', name: 'Studio F Campanario', score: 1 }],
      hasStrongCandidate: true,
    })
    mockValidateAgentActions.mockReturnValueOnce({
      accepted: [{ type: 'set_place', placeId: 'p1' }],
      rejected: [],
    })
    // Run the REAL executeAgentActions (not a hand-mocked result) with
    // PlaceRepository.findById missing the validated id, so this test proves
    // AgentExecutor's genuine set_place no-op drives the gate end-to-end, rather
    // than restating a hand-crafted `executed: []`.
    const { executeAgentActions: realExecuteAgentActions } = jest.requireActual('../AgentExecutor')
    mockFindPlaceById.mockResolvedValueOnce(null)
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockExecuteAgentActions.mockImplementationOnce(realExecuteAgentActions)

    await runAgentTurn(session as any, message, { client: client as any, model: 'gpt-test' })
    consoleErrorSpy.mockRestore()

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    const sent = mockSendGatedMessage.mock.calls[0][1]
    expect(sent.interactive.type).toBe('list')
    expect(sent.interactive.action.sections[0].rows[0]).toEqual({
      id: 'p1',
      title: 'Studio F Campanario',
    })
  })

  // The subtle part (spec): ToolCallLedger accumulates candidates across every
  // search_place call this turn by design (an id offered by an earlier call stays
  // valid for set_place). The list itself must reflect only the LAST call's
  // candidates — what the model's reply is actually about — while
  // session.state.pending_candidates (via the real ToolCallLedger/session.setState,
  // reproduced here since executeSearchPlace is otherwise fully mocked) keeps the
  // full accumulated set so a later free-text reply about the first query still
  // resolves.
  it('with two search_place calls, the list contains ONLY the last call\'s candidates, while session.state.pending_candidates holds both', async () => {
    const setState = jest.fn().mockResolvedValue(undefined)
    const session = buildSession({ setState })
    const message = buildMessage()
    const client = buildClient()
    client.createResponse
      .mockResolvedValueOnce(functionCallsResult('c1', 'search_place'))
      .mockResolvedValueOnce(functionCallsResult('c2', 'search_place'))
      .mockResolvedValueOnce(
        finalResult({ reply: '¿En cuál de estos te recogemos?', actions: [] })
      )

    const firstCandidates = [{ id: 'p1', name: 'Studio F Campanario', score: 1 }]
    const secondCandidates = [
      { id: 'p2', name: 'CLARO CAMPANARIO', score: 1 },
      { id: 'p3', name: 'CINES CAMPANARIO', score: 1 },
    ]

    // Reproduces AgentTools.executeSearchPlace's real ledger/session.state persistence
    // (record every call's candidates into the shared ledger, mocked here since
    // executeSearchPlace itself is jest.mock'd for this whole spec file), so the ledger
    // and session.state assertions below reflect the real accumulation contract.
    mockExecuteSearchPlace.mockImplementationOnce(async (_session, _query, ledger) => {
      ledger.record(firstCandidates.map(({ id, name }) => ({ id, name })))
      await _session.setState({ pending_candidates: ledger.candidates })
      return { candidates: firstCandidates, hasStrongCandidate: false }
    })
    mockExecuteSearchPlace.mockImplementationOnce(async (_session, _query, ledger) => {
      ledger.record(secondCandidates.map(({ id, name }) => ({ id, name })))
      await _session.setState({ pending_candidates: ledger.candidates })
      return { candidates: secondCandidates, hasStrongCandidate: false }
    })

    mockValidateAgentActions.mockReturnValueOnce({ accepted: [], rejected: [] })
    mockExecuteAgentActions.mockResolvedValueOnce({ executed: [], suppressReply: false })

    await runAgentTurn(session as any, message, {
      client: client as any,
      maxToolCalls: 3,
      model: 'gpt-test',
    })

    expect(setState).toHaveBeenCalled()
    const lastPendingCandidates = setState.mock.calls[setState.mock.calls.length - 1][0]
      .pending_candidates
    expect(lastPendingCandidates.map((c: { id: string }) => c.id)).toEqual(['p1', 'p2', 'p3'])

    expect(mockSendGatedMessage).toHaveBeenCalledTimes(1)
    const sent = mockSendGatedMessage.mock.calls[0][1]
    expect(sent.interactive.action.sections[0].rows).toEqual([
      { id: 'p2', title: 'CLARO CAMPANARIO' },
      { id: 'p3', title: 'CINES CAMPANARIO' },
      { id: 'none_of_the_above', title: 'Ninguno de estos' },
    ])
  })
})
