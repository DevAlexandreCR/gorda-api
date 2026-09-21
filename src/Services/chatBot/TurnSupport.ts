import { randomUUID } from 'crypto'
import * as Sentry from '@sentry/node'
import Session from '../../Models/Session'
import SessionRepository from '../../Repositories/SessionRepository'
import DateHelper from '../../Helpers/DateHelper'
import { WpMessage } from '../../Types/WpMessage'
import { ChatBotMessage } from '../../Types/ChatBotMessage'
import { MessageTypes } from '../whatsapp/constants/MessageTypes'

// Extracted from ResponseContract.sendMessage (task 2.8, design D3 "Outbound sends
// MUST go through the same gate + persistence path"): the single outbound-send
// implementation shared by the agent turn, the deterministic flows and (via
// delegation, so legacy behavior stays byte-identical) ResponseContract itself.
// Task 3.4 shrinks ResponseContract down to essentially this helper.

function retryPromise<T>(promiseFactory: () => Promise<T>, maxRetries: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const attempt = (attemptNumber: number) => {
      promiseFactory()
        .then(resolve)
        .catch((error) => {
          if (attemptNumber < maxRetries - 1) {
            console.log(`Retry attempt ${attemptNumber + 1}/${maxRetries}`, {
              error: error.message,
            })
            setTimeout(() => attempt(attemptNumber + 1), 2000)
          } else {
            reject(error)
          }
        })
    }
    attempt(0)
  })
}

async function recordOutboundMessage(session: Session, message: ChatBotMessage): Promise<void> {
  const wpMessage: WpMessage = {
    created_at: DateHelper.unix(),
    id: randomUUID(),
    type: MessageTypes.TEXT,
    msg: message.message,
    processed: true,
    location: null,
    interactiveReply: null,
    interactive: message.interactive ?? null,
    fromMe: true,
  }

  session.messages.set(wpMessage.id, wpMessage)

  try {
    await SessionRepository.addMsg(session.id, wpMessage, true)
  } catch (e) {
    const error = e as Error
    console.error('error persisting outbound message', session.id, error.message, error.stack)
  }
}

/**
 * Shared gated-send path (design D3): turn gate check, retried send through the
 * live chat, then outbound persistence. Byte-identical to the body
 * ResponseContract.sendMessage used to own directly — see that method's comment,
 * kept verbatim below, for why the gate check MUST run before the retried send.
 */
export async function sendGatedMessage(session: Session, message: ChatBotMessage): Promise<void> {
  if (!message.enabled) {
    return
  }

  // Turn gate (design D3) — MUST run before the retryPromise/catch below. A
  // DiscardedTurnError thrown here propagates to the caller untouched (Session.
  // processMessage's catch special-cases it; AgentTurn, task 2.8, does too). If
  // this check were moved past the retryPromise block instead, a benign discard
  // would be caught by that block's `.catch` and rethrow as a genuine send
  // failure on every stale turn. Do not move this below the retryPromise call.
  await session.assertTurnStillValid()

  // Design D9: a factory (not an already-created promise) so each of the three
  // attempts issues a new send instead of re-awaiting the same settled
  // rejection. A failure after all retries is logged, reported to Sentry, and
  // rethrown to the caller — it MUST NOT terminate the process (spec:
  // wp-send-failure-resilience).
  await retryPromise<void>(() => session.sendMessage(message), 3).catch((e) => {
    console.error('failed to send gated message', {
      wpClientId: session.wp_client_id,
      chatId: session.chat_id,
      error: e,
    })
    Sentry.captureException(e)
    throw e instanceof Error ? e : new Error(String(e))
  })

  await recordOutboundMessage(session, message)
}
