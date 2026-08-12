import { Store } from '../../store/Store'
import { WhatsAppClient } from '../../whatsapp/WhatsAppClient'
import SessionRepository from '../../../Repositories/SessionRepository'
import Session from '../../../Models/Session'
import { ConversationTurnPayload } from './ConversationTurnQueue'

// D9: fixed outcome vocabulary logged on every exit path — real failures and
// benign discards must never collide (spec: chatbot-turn-debounce).
type ConversationTurnOutcome = 'completed' | 'superseded_pre_ai' | 'discarded_post_ai' | 'error'

function logOutcome(payload: ConversationTurnPayload, outcome: ConversationTurnOutcome): void {
  console.log('info: conversation turn outcome', {
    wpClientId: payload.wpClientId,
    sessionId: payload.sessionId,
    messageId: payload.messageId,
    outcome,
  })
}

// Resolves the live ChatBot/Session for a queued turn (design D6): the worker
// runs in-process precisely because it needs the in-memory ChatBot.sessions map
// and the Session's live chat connection to send replies. Reached via the
// existing Store.getWhatsAppClient registry (the same mechanism RequestingService
// already uses to reach a WhatsAppClient by wp_client_id).
function resolveSession(wpClientId: string, sessionId: string): Session | undefined {
  const whatsappClient = Store.getInstance().getWhatsAppClient(wpClientId) as
    WhatsAppClient | undefined

  return whatsappClient?.getChatBot().getSessionById(sessionId)
}

// Conversation-turn processor (task 3.6, design D9). Satisfies the
// ConversationTurnProcessor callback type declared in ConversationTurnQueue.ts,
// which is injected into registerConversationTurnQueue by task 3.7.
export async function processConversationTurn(payload: ConversationTurnPayload): Promise<void> {
  let session: Session | undefined
  let turnStarted = false

  try {
    session = resolveSession(payload.wpClientId, payload.sessionId)

    if (!session) {
      // Client gone (never registered / disconnected) or session evicted from
      // memory (e.g. completed and removed by the active-session listener)
      // before this job woke up — nothing to process. Not one of the AI-flow
      // outcomes, but D9's vocabulary has no "unresolvable" bucket, so this
      // is logged as `error`: an in-flight turn job should always find its
      // session live, so this is worth surfacing rather than treated as benign.
      console.warn('conversation turn: could not resolve live session for payload', payload)
      logOutcome(payload, 'error')
      return
    }

    // Pre-AI gate (design D2): re-read fresh state instead of trusting the
    // payload. A null newest-unprocessed-id (nothing left unprocessed — e.g. a
    // prior turn already merged and cleared this batch) also means there is
    // nothing left for this job to do, so it is treated the same as supersede.
    const newestUnprocessedId = await SessionRepository.getNewestUnprocessedMessageId(
      payload.sessionId
    )
    if (newestUnprocessedId !== payload.messageId) {
      logOutcome(payload, 'superseded_pre_ai')
      return
    }

    // Defensive guard: buildMergedUnprocessedMessage has no empty-array contract
    // and throws if the in-memory session has zero unprocessed messages. The gate
    // above reads freshness from the DB while the merge below reads memory, so a
    // memory/DB desync (DB has an unprocessed row, in-memory messages map empty)
    // can pass the gate and crash. Not `superseded_pre_ai` — that outcome is for
    // benign supersedes, and a desync here is a real anomaly worth surfacing.
    if (session.getUnprocessedMessagesArray().length === 0) {
      console.warn(
        'conversation turn: in-memory session has no unprocessed messages (memory/DB desync)',
        payload
      )
      logOutcome(payload, 'error')
      return
    }

    session.beginTurn(payload.messageId)
    turnStarted = true

    const mergedMessage = session.buildMergedUnprocessedMessage()
    const unprocessedMessages = session.getUnprocessedMessagesArray()
    const outcome = await session.processMessage(mergedMessage, unprocessedMessages)

    if (outcome !== 'discarded_post_ai') {
      // 'discarded_post_ai' is already logged by Session.processMessage itself,
      // in this exact {wpClientId, sessionId, messageId, outcome} shape (task
      // 3.5) — logging it again here would double-count the same benign discard.
      logOutcome(payload, outcome)
    }
  } catch (e) {
    // Defensive: Session.processMessage never rejects (task 3.5 catches
    // everything internally), but session resolution and the pre-AI gate run
    // outside that call, so guard the whole turn body — every exit path must
    // log exactly one outcome (design D9), never throw out of the worker.
    console.error('conversation turn: unexpected error', e)
    logOutcome(payload, 'error')
  } finally {
    if (turnStarted) {
      session?.endTurn()
    }
  }
}
