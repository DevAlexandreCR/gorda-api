import { AgentAction } from './AgentPrompt'
import { AgentActionRejection, AgentSessionStatus } from './AgentContextBuilder'

// Action vocabulary and deterministic validation (chatbot-agent-conversation
// spec) / design D3: a pure function, no I/O. AgentTurn (task 2.8) is
// responsible for gathering these facts (tool-call ledger, session.state,
// the merged message, session/service status) and for the regenerate-once
// flow when anything is rejected.

export interface AgentValidationFacts {
  // Place ids offered by search_place in this turn (ToolCallLedger.ids).
  toolPlaceIds: string[]
  // Place ids offered by a previous turn and still pending (session.state.pending_candidates).
  pendingCandidateIds: string[]
  // Whether the merged message for this turn carries a GPS location.
  hasLocationThisTurn: boolean
  // Whether a pin from a previous turn is stored awaiting a reference name
  // (session.state.pending_pin !== null). The spec's "Pin without a name"
  // scenario resolves the pin on a later, text-only turn, so
  // set_place_from_location must accept this case too, not only a location
  // in the current turn (see project_agent_prompt_contract_task22 memory).
  hasPendingPin: boolean
  // Whether a client already exists for this chat.
  clientExists: boolean
  // Whether the session already has a confirmed place.
  placeConfirmed: boolean
  // Session status. The agent (and therefore the validator) only ever runs
  // in these three statuses; SUPPORT/COMPLETED turns never reach the agent.
  sessionStatus: AgentSessionStatus
  // The active service's status when one exists, derived independently of
  // sessionStatus (a session could in principle report REQUESTING_SERVICE
  // or SERVICE_IN_PROGRESS with no loadable service, e.g. an RTDB read
  // failure) — cancel/insist require both an active service AND the
  // matching session status.
  activeServiceStatus: 'REQUESTING_SERVICE' | 'SERVICE_IN_PROGRESS' | null
}

export interface AgentValidationResult {
  // Preserves the original order of `actions`.
  accepted: AgentAction[]
  // One entry per rejected action, in the order they were rejected.
  rejected: AgentActionRejection[]
}

function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'set_client_name':
      return `set_client_name("${action.name}")`
    case 'set_place':
      return `set_place("${action.placeId}")`
    case 'set_place_from_location':
      return `set_place_from_location("${action.reference}")`
    case 'set_comment':
      return `set_comment("${action.text}")`
    case 'create_service':
    case 'cancel_service':
    case 'insist_service':
    case 'escalate_support':
      return action.type
  }
}

interface RunningPreconditions {
  // Whether a client exists by the time this action would run, accounting
  // for a set_client_name accepted earlier in the same action list.
  clientExists: boolean
  // Whether the place is confirmed by the time this action would run,
  // accounting for a set_place/set_place_from_location accepted earlier in
  // the same action list.
  placeConfirmed: boolean
}

/**
 * Returns the rejection reason for `action`, or null when it is valid.
 * `running` reflects facts.clientExists/placeConfirmed as updated by every
 * previously accepted action in this same list (spec: "Action vocabulary
 * and deterministic validation" — create_service's preconditions must see a
 * client/place set earlier in the same turn's action list).
 */
function rejectionReason(
  action: AgentAction,
  facts: AgentValidationFacts,
  running: RunningPreconditions
): string | null {
  switch (action.type) {
    case 'set_place': {
      if (
        facts.toolPlaceIds.includes(action.placeId) ||
        facts.pendingCandidateIds.includes(action.placeId)
      ) {
        return null
      }
      return `placeId "${action.placeId}" was not returned by search_place this turn and is not a pending candidate`
    }

    case 'set_place_from_location': {
      if (facts.hasLocationThisTurn || facts.hasPendingPin) return null
      return 'no GPS location in this turn and no pending pin stored for this session'
    }

    case 'set_client_name': {
      if (!running.clientExists) return null
      return 'a client already exists for this chat'
    }

    case 'create_service': {
      const missing: string[] = []
      if (!running.clientExists) missing.push('no client set')
      if (!running.placeConfirmed) missing.push('no confirmed place')
      if (missing.length === 0) return null
      return `cannot create a service: ${missing.join(' and ')}`
    }

    case 'cancel_service': {
      if (facts.activeServiceStatus === null) return 'no active service to cancel'
      if (
        facts.sessionStatus !== 'REQUESTING_SERVICE' &&
        facts.sessionStatus !== 'SERVICE_IN_PROGRESS'
      ) {
        return `cancel_service is not allowed while the session is ${facts.sessionStatus}`
      }
      return null
    }

    case 'insist_service': {
      if (facts.activeServiceStatus === null) return 'no active service to insist on'
      if (facts.sessionStatus !== 'REQUESTING_SERVICE') {
        return `insist_service is only allowed while the session is REQUESTING_SERVICE (currently ${facts.sessionStatus})`
      }
      return null
    }

    case 'set_comment':
    case 'escalate_support':
      return null
  }
}

/**
 * Validates the agent's proposed actions against deterministic facts about
 * this turn (chatbot-agent-conversation spec, "Action vocabulary and
 * deterministic validation" / design D3). Pure function: no repository or
 * network access. Actions are evaluated and executed in the given order;
 * `create_service` and `set_client_name` see the client/place state left by
 * any earlier action in the same list that this function itself accepted.
 */
export function validateAgentActions(
  actions: AgentAction[],
  facts: AgentValidationFacts
): AgentValidationResult {
  const accepted: AgentAction[] = []
  const rejected: AgentActionRejection[] = []

  const running: RunningPreconditions = {
    clientExists: facts.clientExists,
    placeConfirmed: facts.placeConfirmed,
  }

  for (const action of actions) {
    const reason = rejectionReason(action, facts, running)
    if (reason !== null) {
      rejected.push({ action: describeAction(action), reason })
      continue
    }

    accepted.push(action)

    if (action.type === 'set_client_name') running.clientExists = true
    if (action.type === 'set_place' || action.type === 'set_place_from_location') {
      running.placeConfirmed = true
    }
  }

  return { accepted, rejected }
}
