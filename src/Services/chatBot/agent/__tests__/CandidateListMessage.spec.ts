import { buildCandidateListInteractive, NONE_OF_THE_ABOVE_ROW_ID } from '../CandidateListMessage'
import { AgentToolCandidate } from '../AgentTools'

function candidate(id: string, name: string): AgentToolCandidate {
  return { id, name, score: 0 }
}

describe('buildCandidateListInteractive', () => {
  it('builds a list Interactive with the reply as body text and one row per candidate', () => {
    const candidates = [candidate('p1', 'Studio F Campanario'), candidate('p2', 'CLARO CAMPANARIO')]

    const interactive = buildCandidateListInteractive('¿En cuál te recogemos?', candidates)

    expect(interactive.type).toBe('list')
    expect(interactive.body).toEqual({ text: '¿En cuál te recogemos?' })
    expect(interactive.action.button).toBe('Ver opciones')
    expect(interactive.action.sections).toHaveLength(1)
    expect(interactive.action.sections?.[0].rows).toEqual([
      { id: 'p1', title: 'Studio F Campanario' },
      { id: 'p2', title: 'CLARO CAMPANARIO' },
      { id: 'none_of_the_above', title: 'Ninguno de estos' },
    ])
  })

  it('never truncates candidate names: full, untruncated place names carried through', () => {
    const longName = 'Campanario Centro Comercial - Torre Empresarial Sur, Local 204-B'
    const interactive = buildCandidateListInteractive('x', [candidate('p1', longName)])

    expect(interactive.action.sections?.[0].rows[0].title).toBe(longName)
  })

  it('candidate rows carry no description', () => {
    const interactive = buildCandidateListInteractive('x', [candidate('p1', 'Salesianas')])

    expect(interactive.action.sections?.[0].rows[0]).not.toHaveProperty('description')
  })

  it('appends the escape row last with the hardcoded Spanish literal', () => {
    const candidates = [candidate('p1', 'A'), candidate('p2', 'B')]

    const interactive = buildCandidateListInteractive('x', candidates)
    const rows = interactive.action.sections?.[0].rows ?? []

    expect(rows[rows.length - 1]).toEqual({
      id: NONE_OF_THE_ABOVE_ROW_ID,
      title: 'Ninguno de estos',
    })
    expect(rows).toHaveLength(3)
  })

  it('bounds the row count at 10 (WhatsApp list limit) even with more than 9 candidates', () => {
    const candidates = Array.from({ length: 15 }, (_, i) => candidate(`p${i}`, `Place ${i}`))

    const interactive = buildCandidateListInteractive('x', candidates)
    const rows = interactive.action.sections?.[0].rows ?? []

    expect(rows.length).toBeLessThanOrEqual(10)
    expect(rows[rows.length - 1].id).toBe(NONE_OF_THE_ABOVE_ROW_ID)
  })

  it('with zero candidates still returns just the escape row', () => {
    const interactive = buildCandidateListInteractive('x', [])
    const rows = interactive.action.sections?.[0].rows ?? []

    expect(rows).toEqual([{ id: NONE_OF_THE_ABOVE_ROW_ID, title: 'Ninguno de estos' }])
  })
})
