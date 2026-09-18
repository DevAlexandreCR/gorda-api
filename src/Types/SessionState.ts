// Per-session JSON state document (design D4/D6). Replaces the fine-grained
// legacy statuses: what is still missing from a booking lives here instead of
// in the status enum. Persisted on every executor write, loaded with the
// session on boot, and cleared to {} when the session leaves BOOKING.
export type SessionStatePlaceCandidate = {
  id: string
  name: string
}

export type SessionStatePendingPin = {
  lat: number
  lng: number
}

export interface SessionState {
  // Comment captured for the booking, before create_service.
  comment: string | null
  // Candidates offered by search_place but not yet chosen; ids stay valid for
  // set_place across turns (chatbot-session-state spec, "Candidates survive a turn").
  pending_candidates: SessionStatePlaceCandidate[]
  // GPS coordinates awaiting a reference name from the customer.
  pending_pin: SessionStatePendingPin | null
  // What the deterministic location-assistant flow (design D6) is waiting on next.
  awaiting: 'name' | 'reference' | 'comment' | null
}

export const EMPTY_SESSION_STATE: SessionState = {
  comment: null,
  pending_candidates: [],
  pending_pin: null,
  awaiting: null,
}
