import { JobsOptions } from 'bullmq'
import QueueService from '../../queue/QueueService'

// Identifiers only — the turn processor (task 3.6) re-reads fresh state from
// Postgres instead of trusting the payload, mirroring libi (design D2).
export interface ConversationTurnPayload {
  wpClientId: string
  sessionId: string
  chatId: string
  messageId: string
}

// A failed AI turn already has strategy-level error fallback (Session.processMessage's
// .catch()); queue retries would double-send, so turns never retry (design D6).
export const CONVERSATION_TURN_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
}

// One queue per WpClient (design D6) — keeps one slow client's AI turns from
// head-of-line-blocking another client's.
export function getConversationTurnQueueName(wpClientId: string): string {
  return `chatbot-turn-${wpClientId}`
}

// Injected rather than imported: the real processor (task 3.6) needs ChatBot/Session,
// which this module must stay free of so 3.6 can plug in without a circular import.
export type ConversationTurnProcessor = (payload: ConversationTurnPayload) => Promise<void>

// Registers the per-WpClient queue and its worker. Safe to call more than once for the
// same wpClientId (e.g. WhatsAppClient.onReady re-firing on reconnect/restartChromium):
// QueueService.addQueue/addWorker are idempotent and skip re-registration (task 1.2).
export function registerConversationTurnQueue(wpClientId: string, processor: ConversationTurnProcessor): void {
  const queueService = QueueService.getInstance()
  const queueName = getConversationTurnQueueName(wpClientId)

  queueService.addQueue(queueName)
  queueService.addWorker(queueName, async (data: ConversationTurnPayload) => {
    await processor(data)
  })
}

// Enqueues one turn job. Callers pass an explicit delay in ms: config.CHATBOT_DEBOUNCE_MS
// for debounceable text messages, 0 for location/interactive replies and boot-time sweeps.
export function enqueueConversationTurn(payload: ConversationTurnPayload, delayMs: number): void {
  const queueService = QueueService.getInstance()
  const queueName = getConversationTurnQueueName(payload.wpClientId)

  queueService.add(queueName, payload, { ...CONVERSATION_TURN_JOB_OPTIONS, delay: delayMs })
}
