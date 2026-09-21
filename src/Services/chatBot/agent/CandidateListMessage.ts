import { Interactive } from '../../whatsapp/services/Official/Constants/Interactive'
import { AgentToolCandidate } from './AgentTools'

// Row id for the customer's "none of these" escape hatch. AgentValidator's
// set_place provenance check (toolPlaceIds / pendingCandidateIds) never contains this
// id, so a customer tapping it (or typing its ordinal) can never be promoted into a
// valid set_place — it stays a plain-text pick the model resolves as free text.
export const NONE_OF_THE_ABOVE_ROW_ID = 'none_of_the_above'

// WhatsApp's hard limit on rows in a single `list` interactive message. Reserving one
// row for the escape option below caps candidates at MAX_LIST_ROWS - 1; kept as a
// defensive bound (not merely a comment) so a future bump to
// AgentTools.SEARCH_PLACE_MAX_CANDIDATES cannot silently produce an unsendable list.
const MAX_LIST_ROWS = 10

/**
 * Builds the `Interactive` (chatbot-agent-conversation spec follow-up: render
 * search_place candidates as a selectable list instead of leaving the model to
 * enumerate them in prose) that AgentTurn attaches to the model's reply when it
 * searched for a place and set none this turn. Row ids are the PLACE ids
 * (renderInteractiveAsText numbers them for Baileys; resolveInteractiveOption resolves
 * a customer's "2" back to the matching row id, which AgentValidator then accepts as
 * a set_place placeId straight from session.state.pending_candidates) — this is the
 * only reason a plain-text ordinal reply round-trips with no new plumbing.
 */
export function buildCandidateListInteractive(
  replyText: string,
  candidates: AgentToolCandidate[]
): Interactive {
  const rows = candidates
    .slice(0, MAX_LIST_ROWS - 1)
    .map((candidate) => ({ id: candidate.id, title: candidate.name }))

  // Deliberate hardcoded Spanish literal: this is a WhatsApp row label the customer
  // taps, not a customizable catalog message. MessagesEnum.NONE_OF_THE_ABOVE is dead
  // code — declared in the enum, referenced nowhere else, and backed by no
  // `chatbot_messages` row — so it is not reused here.
  rows.push({ id: NONE_OF_THE_ABOVE_ROW_ID, title: 'Ninguno de estos' })

  if (rows.length > MAX_LIST_ROWS) {
    throw new Error(
      `CandidateListMessage: ${rows.length} rows exceeds WhatsApp's ${MAX_LIST_ROWS}-row list limit`
    )
  }

  return {
    type: 'list',
    body: { text: replyText },
    action: {
      button: 'Ver opciones',
      sections: [{ rows }],
    },
  }
}
