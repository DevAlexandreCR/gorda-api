import { validateAgentActions, AgentValidationFacts } from '../AgentValidator'
import { AgentAction } from '../AgentPrompt'
import { NONE_OF_THE_ABOVE_ROW_ID } from '../CandidateListMessage'

function baseFacts(overrides: Partial<AgentValidationFacts> = {}): AgentValidationFacts {
  return {
    toolPlaceIds: [],
    pendingCandidateIds: [],
    hasLocationThisTurn: false,
    hasPendingPin: false,
    clientExists: false,
    placeConfirmed: false,
    sessionStatus: 'BOOKING',
    activeServiceStatus: null,
    ...overrides,
  }
}

describe('validateAgentActions', () => {
  describe('set_place', () => {
    it('accepts a placeId returned by search_place this turn', () => {
      const action: AgentAction = { type: 'set_place', placeId: 'p1' }
      const result = validateAgentActions([action], baseFacts({ toolPlaceIds: ['p1'] }))

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('accepts a placeId stored as a pending candidate from a previous turn', () => {
      const action: AgentAction = { type: 'set_place', placeId: 'p2' }
      const result = validateAgentActions([action], baseFacts({ pendingCandidateIds: ['p2'] }))

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects a placeId neither offered this turn nor pending', () => {
      const action: AgentAction = { type: 'set_place', placeId: 'abc123' }
      const result = validateAgentActions([action], baseFacts())

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([
        {
          action: 'set_place("abc123")',
          reason: expect.stringContaining('abc123'),
        },
      ])
    })

    // CandidateListMessage's escape row: its id must never be a valid placeId, since it
    // is never a member of toolPlaceIds or pendingCandidateIds — asserted explicitly
    // rather than assumed, since a customer tapping "Ninguno de estos" still promotes
    // to a synthesized list_reply (resolveInteractiveOption) whose id reaches this
    // validator like any other pick.
    it('rejects none_of_the_above as a placeId even when it happens to be offered/pending', () => {
      const action: AgentAction = { type: 'set_place', placeId: NONE_OF_THE_ABOVE_ROW_ID }
      const result = validateAgentActions(
        [action],
        baseFacts({ toolPlaceIds: [], pendingCandidateIds: [] })
      )

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([
        {
          action: `set_place("${NONE_OF_THE_ABOVE_ROW_ID}")`,
          reason: expect.stringContaining(NONE_OF_THE_ABOVE_ROW_ID),
        },
      ])
    })
  })

  describe('set_place_from_location', () => {
    it('accepts when the merged turn carries a GPS location', () => {
      const action: AgentAction = {
        type: 'set_place_from_location',
        reference: 'frente a la panadería',
      }
      const result = validateAgentActions([action], baseFacts({ hasLocationThisTurn: true }))

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('accepts when there is no location this turn but a pin is pending from a previous turn', () => {
      const action: AgentAction = { type: 'set_place_from_location', reference: 'casa verde' }
      const result = validateAgentActions([action], baseFacts({ hasPendingPin: true }))

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects when there is neither a location this turn nor a pending pin', () => {
      const action: AgentAction = { type: 'set_place_from_location', reference: 'casa verde' }
      const result = validateAgentActions([action], baseFacts())

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([
        { action: 'set_place_from_location("casa verde")', reason: expect.any(String) },
      ])
    })
  })

  describe('set_client_name', () => {
    it('accepts when no client exists for the chat', () => {
      const action: AgentAction = { type: 'set_client_name', name: 'Ana' }
      const result = validateAgentActions([action], baseFacts({ clientExists: false }))

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects when a client already exists for the chat', () => {
      const action: AgentAction = { type: 'set_client_name', name: 'Ana' }
      const result = validateAgentActions([action], baseFacts({ clientExists: true }))

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([
        { action: 'set_client_name("Ana")', reason: expect.any(String) },
      ])
    })
  })

  describe('create_service', () => {
    it('accepts when the client exists and the place is confirmed', () => {
      const action: AgentAction = { type: 'create_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({ clientExists: true, placeConfirmed: true })
      )

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects when there is no client and no confirmed place', () => {
      const action: AgentAction = { type: 'create_service' }
      const result = validateAgentActions([action], baseFacts())

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([{ action: 'create_service', reason: expect.any(String) }])
    })
  })

  describe('cancel_service', () => {
    it('accepts when an active service exists and the session is REQUESTING_SERVICE', () => {
      const action: AgentAction = { type: 'cancel_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({
          sessionStatus: 'REQUESTING_SERVICE',
          activeServiceStatus: 'REQUESTING_SERVICE',
        })
      )

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('accepts when an active service exists and the session is SERVICE_IN_PROGRESS', () => {
      const action: AgentAction = { type: 'cancel_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({
          sessionStatus: 'SERVICE_IN_PROGRESS',
          activeServiceStatus: 'SERVICE_IN_PROGRESS',
        })
      )

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects when there is no active service', () => {
      const action: AgentAction = { type: 'cancel_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({ sessionStatus: 'REQUESTING_SERVICE', activeServiceStatus: null })
      )

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([{ action: 'cancel_service', reason: expect.any(String) }])
    })

    it('rejects when the session is BOOKING even if an active service somehow exists', () => {
      const action: AgentAction = { type: 'cancel_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({ sessionStatus: 'BOOKING', activeServiceStatus: 'REQUESTING_SERVICE' })
      )

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([{ action: 'cancel_service', reason: expect.any(String) }])
    })
  })

  describe('insist_service', () => {
    it('accepts when an active service exists and the session is REQUESTING_SERVICE', () => {
      const action: AgentAction = { type: 'insist_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({
          sessionStatus: 'REQUESTING_SERVICE',
          activeServiceStatus: 'REQUESTING_SERVICE',
        })
      )

      expect(result).toEqual({ accepted: [action], rejected: [] })
    })

    it('rejects when the session is SERVICE_IN_PROGRESS (only REQUESTING_SERVICE is allowed)', () => {
      const action: AgentAction = { type: 'insist_service' }
      const result = validateAgentActions(
        [action],
        baseFacts({
          sessionStatus: 'SERVICE_IN_PROGRESS',
          activeServiceStatus: 'SERVICE_IN_PROGRESS',
        })
      )

      expect(result.accepted).toEqual([])
      expect(result.rejected).toEqual([{ action: 'insist_service', reason: expect.any(String) }])
    })
  })

  describe('set_comment and escalate_support', () => {
    it('are always valid', () => {
      const actions: AgentAction[] = [
        { type: 'set_comment', text: 'casa verde puerta blanca' },
        { type: 'escalate_support' },
      ]
      const result = validateAgentActions(actions, baseFacts())

      expect(result).toEqual({ accepted: actions, rejected: [] })
    })
  })

  it('passes an all-valid action list through unchanged and in order', () => {
    const actions: AgentAction[] = [
      { type: 'set_client_name', name: 'Ana' },
      { type: 'set_comment', text: 'casa verde puerta blanca' },
      { type: 'escalate_support' },
    ]
    const result = validateAgentActions(actions, baseFacts())

    expect(result).toEqual({ accepted: actions, rejected: [] })
  })

  it('lets create_service see a client and place set earlier in the same action list (in-order dependency)', () => {
    const actions: AgentAction[] = [
      { type: 'set_client_name', name: 'Ana' },
      { type: 'set_place', placeId: 'p1' },
      { type: 'create_service' },
    ]
    const result = validateAgentActions(
      actions,
      baseFacts({ clientExists: false, placeConfirmed: false, toolPlaceIds: ['p1'] })
    )

    expect(result).toEqual({ accepted: actions, rejected: [] })
  })
})
