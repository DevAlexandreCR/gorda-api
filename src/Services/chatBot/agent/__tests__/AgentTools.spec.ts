const mockFindPlacesWithSuggestions = jest.fn()

jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({
      findPlacesWithSuggestions: mockFindPlacesWithSuggestions,
    })),
  },
}))

import {
  executeSearchPlace,
  searchPlaceTool,
  toolsForTurn,
  ToolCallLedger,
  SEARCH_PLACE_MAX_CANDIDATES,
} from '../AgentTools'
import Session from '../../../../Models/Session'

function buildMockSession(): { setState: jest.Mock } {
  return { setState: jest.fn().mockResolvedValue(undefined) }
}

describe('toolsForTurn', () => {
  it('returns no tools when the merged turn carries a GPS location', () => {
    expect(toolsForTurn(true)).toEqual([])
  })

  it('offers search_place when the merged turn has no location', () => {
    expect(toolsForTurn(false)).toEqual([searchPlaceTool])
  })
})

describe('executeSearchPlace', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('maps the top result and suggestions to candidates, passing through hasStrongCandidate', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: {
        id: 'p1',
        name: 'Centro Comercial Unicentro',
        lat: 1,
        lng: 1,
        location: null,
        cityId: 'popayan',
        score: 2.1,
      },
      suggestions: [],
      hasStrongCandidate: true,
    })

    const session = buildMockSession()
    const ledger = new ToolCallLedger()

    const result = await executeSearchPlace(session as unknown as Session, 'unicentro', ledger)

    expect(result).toEqual({
      candidates: [{ id: 'p1', name: 'Centro Comercial Unicentro', score: 2.1 }],
      hasStrongCandidate: true,
    })
  })

  it('bounds candidates to 5, place first then suggestions, deduped by id', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: { id: 'p1', name: 'Place One', lat: 1, lng: 1, location: null, cityId: 'popayan' },
      suggestions: [
        { id: 's1', name: 'Suggestion One' },
        { id: 's2', name: 'Suggestion Two' },
        { id: 's3', name: 'Suggestion Three' },
        { id: 's4', name: 'Suggestion Four' },
        { id: 's5', name: 'Suggestion Five' },
      ],
      hasStrongCandidate: false,
    })

    const session = buildMockSession()
    const ledger = new ToolCallLedger()

    const result = await executeSearchPlace(session as unknown as Session, 'estacion', ledger)

    expect(result.candidates).toHaveLength(SEARCH_PLACE_MAX_CANDIDATES)
    expect(result.candidates.map((c) => c.id)).toEqual(['p1', 's1', 's2', 's3', 's4'])
    expect(result.hasStrongCandidate).toBe(false)
  })

  it('persists the offered candidates into session.state.pending_candidates via setState', async () => {
    mockFindPlacesWithSuggestions.mockResolvedValue({
      place: null,
      suggestions: [
        { id: 's1', name: 'Estación de Policía Centro' },
        { id: 's2', name: 'Estación del Tren' },
      ],
      hasStrongCandidate: false,
    })

    const session = buildMockSession()
    const ledger = new ToolCallLedger()

    await executeSearchPlace(session as unknown as Session, 'estación', ledger)

    expect(session.setState).toHaveBeenCalledTimes(1)
    expect(session.setState).toHaveBeenCalledWith({
      pending_candidates: [
        { id: 's1', name: 'Estación de Policía Centro' },
        { id: 's2', name: 'Estación del Tren' },
      ],
    })
  })

  it('accumulates candidate ids across two search_place calls within the same turn', async () => {
    const session = buildMockSession()
    const ledger = new ToolCallLedger()

    mockFindPlacesWithSuggestions.mockResolvedValueOnce({
      place: null,
      suggestions: [{ id: 's1', name: 'Suggestion One' }],
      hasStrongCandidate: false,
    })
    await executeSearchPlace(session as unknown as Session, 'first query', ledger)

    mockFindPlacesWithSuggestions.mockResolvedValueOnce({
      place: null,
      suggestions: [{ id: 's2', name: 'Suggestion Two' }],
      hasStrongCandidate: false,
    })
    await executeSearchPlace(session as unknown as Session, 'second query', ledger)

    expect(ledger.ids.sort()).toEqual(['s1', 's2'])
    expect(session.setState).toHaveBeenLastCalledWith({
      pending_candidates: expect.arrayContaining([
        { id: 's1', name: 'Suggestion One' },
        { id: 's2', name: 'Suggestion Two' },
      ]),
    })
    expect((session.setState as jest.Mock).mock.calls[1][0].pending_candidates).toHaveLength(2)
  })
})

describe('ToolCallLedger', () => {
  it('reports whether an id was offered and exposes the accumulated candidates', () => {
    const ledger = new ToolCallLedger()
    ledger.record([{ id: 'a', name: 'A' }])
    ledger.record([{ id: 'b', name: 'B' }])

    expect(ledger.has('a')).toBe(true)
    expect(ledger.has('c')).toBe(false)
    expect(ledger.candidates).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
  })
})
