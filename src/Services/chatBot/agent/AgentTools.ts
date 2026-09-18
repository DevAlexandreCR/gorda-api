import Session from '../../../Models/Session'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { SessionStatePlaceCandidate } from '../../../Types/SessionState'
import { Store } from '../../store/Store'
import { FunctionToolDefinition } from './OpenAIResponsesClient'

// Bounded place-search tool calling (chatbot-agent-conversation spec,
// "Bounded place-search tool calling"): the agent's only tool, capped by
// AGENT_MAX_TOOL_CALLS at the AgentTurn level (task 2.8), not here.
export const SEARCH_PLACE_MAX_CANDIDATES = 5

export interface AgentToolCandidate {
  id: string
  name: string
  score: number
}

export interface SearchPlaceToolResult {
  candidates: AgentToolCandidate[]
  hasStrongCandidate: boolean
}

// Strict `{query: string}` schema (design D2: every function tool is strict,
// closed-object parameters).
export const searchPlaceTool: FunctionToolDefinition = {
  type: 'function',
  name: 'search_place',
  description:
    "Searches the place catalog for a pickup location matching the customer's text. " +
    'Returns up to 5 candidates (id, name, score) and hasStrongCandidate, the verdict ' +
    'for whether the top result can be set without asking the customer to confirm. ' +
    'Never call this when the current message carries a GPS location.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'The place text as written or paraphrased by the customer.',
      },
    },
  },
}

/**
 * Per-turn accumulator of place candidates offered by search_place. A single
 * instance must be threaded through every search_place call within one
 * AgentTurn (task 2.8) so a candidate offered by an earlier call in the turn
 * stays valid for `set_place` even after a later call's results are
 * persisted (AgentValidator's place-id provenance check, task 2.5, accepts an
 * id returned by search_place "in this turn" — not just by the last call).
 */
export class ToolCallLedger {
  private readonly offeredById = new Map<string, SessionStatePlaceCandidate>()

  record(candidates: SessionStatePlaceCandidate[]): void {
    for (const candidate of candidates) {
      this.offeredById.set(candidate.id, candidate)
    }
  }

  has(id: string): boolean {
    return this.offeredById.has(id)
  }

  get ids(): string[] {
    return Array.from(this.offeredById.keys())
  }

  get candidates(): SessionStatePlaceCandidate[] {
    return Array.from(this.offeredById.values())
  }
}

interface PlaceSearchResult {
  place: PlaceInterface | null
  suggestions: Array<{ id: string; name: string }>
  hasStrongCandidate: boolean
}

function buildCandidates(searchResult: PlaceSearchResult): AgentToolCandidate[] {
  const candidates: AgentToolCandidate[] = []
  const seenIds = new Set<string>()

  if (searchResult.place) {
    // Store.findPlacesWithSuggestions types its top result as PlaceInterface,
    // but the underlying PlaceSearchRepository row also carries a numeric
    // `score` (see PlaceSearchRepository.SearchResult) that PlaceInterface
    // does not declare; read it defensively rather than widen the interface.
    const topResult = searchResult.place as PlaceInterface & { score?: number }
    candidates.push({
      id: topResult.id,
      name: topResult.name,
      score: typeof topResult.score === 'number' ? topResult.score : 0,
    })
    seenIds.add(topResult.id)
  }

  for (const suggestion of searchResult.suggestions) {
    if (seenIds.has(suggestion.id)) continue
    seenIds.add(suggestion.id)
    // generateSuggestions (PlaceSearchRepository) does not surface a score.
    candidates.push({ id: suggestion.id, name: suggestion.name, score: 0 })
  }

  return candidates.slice(0, SEARCH_PLACE_MAX_CANDIDATES)
}

/**
 * Executes the search_place tool call over the existing place search
 * (Store.findPlacesWithSuggestions, same repository AskingForPlace's
 * runPlaceSearchFlow used) and persists the candidates offered so far this
 * turn as pending on the session (chatbot-place-resolution spec, "Ambiguous
 * results keep confirmation flow"). `ledger` must be the same instance across
 * every search_place call in this turn so ids from earlier calls are not
 * dropped when a later call's candidates are persisted.
 */
export async function executeSearchPlace(
  session: Session,
  query: string,
  ledger: ToolCallLedger
): Promise<SearchPlaceToolResult> {
  const searchResult = await Store.getInstance().findPlacesWithSuggestions(query)
  const candidates = buildCandidates(searchResult)

  ledger.record(candidates.map(({ id, name }) => ({ id, name })))
  await session.setState({ pending_candidates: ledger.candidates })

  return { candidates, hasStrongCandidate: searchResult.hasStrongCandidate }
}

/**
 * The tools offered to the model this turn. The spec requires the tool be
 * withheld entirely (not merely discouraged in the prompt) when the merged
 * turn carries a GPS location, since the place then comes from the pin.
 */
export function toolsForTurn(currentMessageHasLocation: boolean): FunctionToolDefinition[] {
  return currentMessageHasLocation ? [] : [searchPlaceTool]
}
