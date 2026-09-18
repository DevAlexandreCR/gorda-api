import config from '../../../../config'
import Session from '../../../Models/Session'
import { WpMessage } from '../../../Types/WpMessage'
import { ChatBotMessage } from '../../../Types/ChatBotMessage'
import * as Messages from '../Messages'
import { MessagesEnum } from '../MessagesEnum'
import { DiscardedTurnError } from '../turns/DiscardedTurnError'
import { sendGatedMessage } from '../TurnSupport'
import {
  OpenAIResponsesClient,
  OpenAIResponsesParseError,
  ResponsesInputItem,
  FunctionToolDefinition,
} from './OpenAIResponsesClient'
import {
  buildAgentContext,
  buildAgentInput,
  AgentContext,
  AgentActionRejection,
} from './AgentContextBuilder'
import {
  AgentOutput,
  AgentActionType,
  AGENT_OUTPUT_JSON_SCHEMA,
  getAgentPrompt,
} from './AgentPrompt'
import { toolsForTurn, executeSearchPlace, ToolCallLedger } from './AgentTools'
import { validateAgentActions, AgentValidationFacts } from './AgentValidator'
import { executeAgentActions, storePendingPin, AgentExecutorContext } from './AgentExecutor'

// AgentTurn (task 2.8, design D2/D3): orchestrates one full agent turn — model
// loop (bounded tool-calling) -> validate -> (regenerate once on rejection) ->
// execute -> send. This module OWNS every model/schema/validation failure: it
// never rethrows to Session.processMessage's generic catch (design D3
// "Failure ownership"). The single exception is DiscardedTurnError from the
// turn gate (sendGatedMessage / session.assertTurnStillValid / bookService),
// which MUST propagate untouched with no fallback message and no side effects
// after it.

export interface AgentTurnDeps {
  // Injected for tests; defaults to a real client built from config.
  client?: OpenAIResponsesClient
  // Overrides config.AGENT_MAX_TOOL_CALLS.
  maxToolCalls?: number
  // Overrides config.OPENAI_MODEL (passed through to every model call).
  model?: string
  // Overrides config.OPENAI_REASONING_EFFORT.
  reasoningEffort?: string
  // Clock injection for deterministic latencyMs assertions in tests.
  now?: () => number
}

export interface AgentTurnOutcome {
  // True iff the customer-facing reply came from the fallback path (a still-
  // invalid regenerated output, a model outage, or any other owned failure) —
  // never true together with any executed action.
  fallback: boolean
  // Total search_place calls executed this turn, across both the first model
  // call chain and the one allowed regeneration.
  toolCalls: number
  // AgentExecutor's `executed`, in order; empty on the fallback path.
  actions: AgentActionType[]
  // Every rejection collected this turn (first attempt's, then the second
  // attempt's if it ran too) — empty when nothing was ever rejected.
  rejected: AgentActionRejection[]
  latencyMs: number
  model: string
}

// Task 2.9 / design D9: exactly one structured log line per completed turn
// (success or fallback) — never emitted on the DiscardedTurnError/gate-discard
// path, which stays silent by design (no side effects at all).
function logAgentTurn(session: Session, messageId: string, outcome: AgentTurnOutcome): void {
  console.log(
    JSON.stringify({
      event: 'agent_turn',
      wpClientId: session.wp_client_id,
      sessionId: session.id,
      messageId,
      model: outcome.model,
      toolCalls: outcome.toolCalls,
      actions: outcome.actions,
      rejected: outcome.rejected,
      latencyMs: outcome.latencyMs,
      fallback: outcome.fallback,
    })
  )
}

function buildReplyMessage(replyText: string): ChatBotMessage {
  // Same vehicle the retired ai/* strategies used for a free-text model reply
  // (ResponseContract.sendAIMessage / Created.ts's `sendAIMessage(DEFAULT_MESSAGE, ...)`):
  // the DEFAULT_MESSAGE catalog entry with its text overridden. Store.findMessageById
  // synthesizes an `enabled: true` DEFAULT_MESSAGE even when no DB row exists, so this
  // never silently drops the agent's reply.
  const msg = Messages.getSingleMessage(MessagesEnum.DEFAULT_MESSAGE)
  msg.message = replyText
  if (msg.interactive?.body) {
    msg.interactive.body.text = replyText
  }
  return msg
}

function deriveActiveServiceStatus(
  context: AgentContext
): 'REQUESTING_SERVICE' | 'SERVICE_IN_PROGRESS' | null {
  // Independent of session.status by construction: context.service is only
  // non-null when AgentContextBuilder actually loaded the active service, so a
  // session whose status claims REQUESTING_SERVICE/SERVICE_IN_PROGRESS but
  // whose service failed to load still yields null here (AgentValidator memory
  // note: cancel/insist must reject in that case).
  if (!context.service) return null
  if (context.session.status === 'REQUESTING_SERVICE') return 'REQUESTING_SERVICE'
  if (context.session.status === 'SERVICE_IN_PROGRESS') return 'SERVICE_IN_PROGRESS'
  return null
}

function buildValidationFacts(
  context: AgentContext,
  session: Session,
  ledger: ToolCallLedger,
  hasLocationThisTurn: boolean
): AgentValidationFacts {
  return {
    toolPlaceIds: ledger.ids,
    pendingCandidateIds: session.state.pending_candidates.map((candidate) => candidate.id),
    hasLocationThisTurn,
    hasPendingPin: session.state.pending_pin !== null,
    clientExists: context.client !== null,
    placeConfirmed: context.session.place !== null,
    sessionStatus: context.session.status,
    activeServiceStatus: deriveActiveServiceStatus(context),
  }
}

// Bounded place-search tool calling (spec "Bounded place-search tool calling" /
// design D2): runs one Responses-API round-trip loop for a single model
// "attempt" (the first call, or the one allowed regeneration), refusing any
// search_place call beyond maxToolCalls and forcing a `tool_choice: "none"`
// finalize call once the budget is spent. A defensive round cap
// (maxToolCalls + 2) guards against a misbehaving/mocked client that never
// finalizes, surfacing as a parse error the outer try/catch turns into the
// owned fallback rather than an infinite loop.
async function runModelLoop(params: {
  client: OpenAIResponsesClient
  instructions: string
  input: ResponsesInputItem[]
  tools: FunctionToolDefinition[]
  maxToolCalls: number
  session: Session
  ledger: ToolCallLedger
  model?: string
  reasoningEffort?: string
}): Promise<{ output: AgentOutput; toolCallCount: number }> {
  const { client, instructions, tools, maxToolCalls, session, ledger, model, reasoningEffort } =
    params
  let input = params.input
  let toolCallCount = 0
  let forceFinalize = false
  const maxRounds = maxToolCalls + 2

  for (let round = 0; round < maxRounds; round++) {
    const result = await client.createResponse<AgentOutput>({
      input,
      instructions,
      tools,
      toolChoice: forceFinalize ? 'none' : undefined,
      textFormat: AGENT_OUTPUT_JSON_SCHEMA,
      model,
      reasoningEffort,
    })

    if (result.type === 'final') {
      return { output: result.data, toolCallCount }
    }

    const functionOutputs: Array<{ callId: string; output: string }> = []
    for (const call of result.calls) {
      const toolOffered = tools.some((tool) => tool.name === call.name)

      if (toolOffered && toolCallCount < maxToolCalls) {
        const args = (call.arguments ?? {}) as { query?: string }
        const toolResult = await executeSearchPlace(session, args.query ?? '', ledger)
        toolCallCount++
        functionOutputs.push({ callId: call.callId, output: JSON.stringify(toolResult) })
      } else {
        // Tool budget exhausted (spec "Tool budget exhausted") or a tool call for a
        // tool not offered this turn (defensive: e.g. search_place requested on a
        // location turn, where toolsForTurn withheld it) — refused, not executed.
        functionOutputs.push({
          callId: call.callId,
          output: JSON.stringify({ error: 'tool_call_refused' }),
        })
      }
    }

    input = client.buildFollowUpInput(input, result.rawOutput, functionOutputs)

    if (toolCallCount >= maxToolCalls) {
      forceFinalize = true
    }
  }

  throw new OpenAIResponsesParseError(
    'AgentTurn: model did not finalize within the tool-call round budget'
  )
}

/**
 * Runs one full agent turn (chatbot-agent-conversation spec, design D2/D3).
 * Never rejects except with DiscardedTurnError (the turn gate's sentinel,
 * design D3) — every other failure is owned here: the customer gets
 * ERROR_WHILE_PROCESSING exactly once, the session moves to SUPPORT, and the
 * function returns normally.
 */
export async function runAgentTurn(
  session: Session,
  currentMessage: WpMessage,
  deps: AgentTurnDeps = {}
): Promise<AgentTurnOutcome> {
  const client = deps.client ?? new OpenAIResponsesClient()
  const maxToolCalls = deps.maxToolCalls ?? config.AGENT_MAX_TOOL_CALLS
  const model = deps.model ?? config.OPENAI_MODEL
  const reasoningEffort = deps.reasoningEffort
  const now = deps.now ?? Date.now
  const startedAt = now()

  const hasLocationThisTurn = currentMessage.location !== null
  const ledger = new ToolCallLedger()
  const allRejected: AgentActionRejection[] = []
  let fallbackSent = false

  // Sends the configured processing-error fallback and moves the session to
  // SUPPORT (spec "Support escalation and failure fallback"). Idempotent within
  // one turn: only the first call actually sends/transitions, guarding against
  // a double message if this is reached from more than one place. If the send
  // itself throws DiscardedTurnError, it propagates untouched (no further
  // action here) — exactly the "no side effects after it" requirement.
  const sendFallbackOnce = async (): Promise<void> => {
    if (fallbackSent) return
    fallbackSent = true
    await sendGatedMessage(session, Messages.getSingleMessage(MessagesEnum.ERROR_WHILE_PROCESSING))
    await session.setStatus(Session.STATUS_SUPPORT)
  }

  try {
    const instructions = getAgentPrompt()

    const first = await buildAgentContext(session, currentMessage)
    const firstInput = buildAgentInput(first.context, first.history, currentMessage)
    const tools = toolsForTurn(hasLocationThisTurn)

    let toolCalls = 0
    let loopResult = await runModelLoop({
      client,
      instructions,
      input: firstInput,
      tools,
      maxToolCalls,
      session,
      ledger,
      model,
      reasoningEffort,
    })
    toolCalls += loopResult.toolCallCount

    let facts = buildValidationFacts(first.context, session, ledger, hasLocationThisTurn)
    let validation = validateAgentActions(loopResult.output.actions, facts)

    if (validation.rejected.length > 0) {
      allRejected.push(...validation.rejected)
      console.warn('AgentTurn: action(s) rejected, regenerating once', {
        sessionId: session.id,
        messageId: currentMessage.id,
        rejected: validation.rejected,
      })

      const retry = await buildAgentContext(session, currentMessage, {
        systemEvents: [{ type: 'action_rejected', rejections: validation.rejected }],
      })
      const retryInput = buildAgentInput(retry.context, retry.history, currentMessage)

      loopResult = await runModelLoop({
        client,
        instructions,
        input: retryInput,
        tools,
        maxToolCalls,
        session,
        ledger,
        model,
        reasoningEffort,
      })
      toolCalls += loopResult.toolCallCount

      facts = buildValidationFacts(retry.context, session, ledger, hasLocationThisTurn)
      validation = validateAgentActions(loopResult.output.actions, facts)

      if (validation.rejected.length > 0) {
        allRejected.push(...validation.rejected)
        console.error('AgentTurn: second output still invalid, escalating to SUPPORT', {
          sessionId: session.id,
          messageId: currentMessage.id,
          rejected: validation.rejected,
        })

        await sendFallbackOnce()

        const outcome: AgentTurnOutcome = {
          fallback: true,
          toolCalls,
          actions: [],
          rejected: allRejected,
          latencyMs: now() - startedAt,
          model,
        }
        logAgentTurn(session, currentMessage.id, outcome)
        return outcome
      }
    }

    // Turn gate before any side effect (design D3), checked once explicitly
    // right before executing accepted actions. DiscardedTurnError here — or
    // from any gated send/write inside the executor below — propagates
    // untouched to the caller (hard rule): no fallback, no further action.
    await session.assertTurnStillValid()

    const executorCtx: AgentExecutorContext = {
      sendMessage: (message) => sendGatedMessage(session, message),
      currentMessage,
      placeCandidates: [...ledger.candidates, ...session.state.pending_candidates],
    }

    const result = await executeAgentActions(session, validation.accepted, executorCtx)

    // GPS location fixes the place without search / "Pin without a name": the
    // agent may legitimately ask for a reference name instead of resolving the
    // pin this turn (or emit unrelated actions), in which case the pin must be
    // stored so a later text-only turn can complete it.
    if (
      hasLocationThisTurn &&
      currentMessage.location &&
      !validation.accepted.some((action) => action.type === 'set_place_from_location')
    ) {
      await storePendingPin(session, currentMessage.location)
    }

    if (result.halted !== 'non_covered_area') {
      const reply = loopResult.output.reply?.trim() ?? ''
      if (!result.suppressReply && reply !== '') {
        await sendGatedMessage(session, buildReplyMessage(reply))
      }
    }

    const outcome: AgentTurnOutcome = {
      fallback: false,
      toolCalls,
      actions: result.executed,
      rejected: allRejected,
      latencyMs: now() - startedAt,
      model,
    }
    logAgentTurn(session, currentMessage.id, outcome)
    return outcome
  } catch (error) {
    if (error instanceof DiscardedTurnError) {
      throw error
    }

    console.error('AgentTurn: turn failed, falling back', {
      sessionId: session.id,
      messageId: currentMessage.id,
      error: (error as Error).message,
      stack: (error as Error).stack,
    })

    await sendFallbackOnce()

    const outcome: AgentTurnOutcome = {
      fallback: true,
      toolCalls: ledger.ids.length,
      actions: [],
      rejected: allRejected,
      latencyMs: now() - startedAt,
      model,
    }
    logAgentTurn(session, currentMessage.id, outcome)
    return outcome
  }
}
