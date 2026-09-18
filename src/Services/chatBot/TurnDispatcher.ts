import Session from '../../Models/Session'
import { WpMessage } from '../../Types/WpMessage'
import { Store } from '../store/Store'
import { runAgentTurn } from './agent/AgentTurn'
import { runLocationAssistantTurn } from './assistant/LocationAssistantFlow'
import { sendGatedMessage } from './TurnSupport'
import {
  cancelService,
  handleInTripMessage,
  insistService,
  isCancelButton,
  isInsistMessage,
} from './deterministic/DeterministicHandlers'

/**
 * Dispatches one conversation turn by the WhatsApp line's mode (design D5,
 * spec chatbot-session-state "Dispatch by line mode"). Session.processMessage
 * calls this in place of the deleted ResponseContext.getResponse(status) map.
 *
 * Precedence mirrors design D5's pseudocode exactly: SUPPORT/COMPLETED is a
 * no-op regardless of line settings; an `assistant` line always runs the
 * deterministic location flow (a line is never configured with both flags,
 * but if it were, assistant wins, same order as the design table); a
 * `chatBot` line runs the agent, except the CANCEL/INSIST *button* replies in
 * REQUESTING_SERVICE, which are short-circuited deterministically without a
 * model call (free text "cancelar" still reaches the agent, which owns its
 * own cancel_service action there); SERVICE_IN_PROGRESS on a chatBot line
 * runs the agent only when agentInTrip is enabled, otherwise falls back to
 * the cancel-only deterministic handler. Neither flag set is a no-op.
 */
export async function dispatchTurn(session: Session, message: WpMessage): Promise<void> {
  if (session.status === Session.STATUS_SUPPORT || session.status === Session.STATUS_COMPLETED) {
    return
  }

  const wpClient = Store.getInstance().wpClients[session.wp_client_id]

  if (wpClient?.assistant) {
    await runLocationAssistantTurn(session, message)
    return
  }

  if (!wpClient?.chatBot) {
    return
  }

  if (session.status === Session.STATUS_SERVICE_IN_PROGRESS) {
    if (wpClient.agentInTrip) {
      await runAgentTurn(session, message)
    } else {
      await handleInTripMessage(session, message)
    }
    return
  }

  if (session.status === Session.STATUS_REQUESTING_SERVICE) {
    if (isCancelButton(message)) {
      await cancelService(session)
      return
    }
    if (isInsistMessage(message)) {
      await insistService(session, (m) => sendGatedMessage(session, m))
      return
    }
  }

  // BOOKING, or REQUESTING_SERVICE not short-circuited above (including free
  // text "cancelar", which the agent handles via its own cancel_service action).
  await runAgentTurn(session, message)
}
