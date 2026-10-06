import PlaceSearchRepository, { NORMALIZED_NAME_SQL } from '../PlaceSearchRepository'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * PlaceSearchRepository takes a raw `Sequelize` instance and issues its four
 * search strategies (exact/keyword/fuzzy/content) plus the suggestions query
 * as separate `sequelize.query(sql, ...)` calls. There is no live-DB harness
 * in this suite (see other Repository specs), so each strategy's SQL is
 * distinguished by a stable fingerprint substring and stubbed to return
 * canned rows shaped like what Postgres would hand back — i.e. the *base*
 * score/coverage before `smartSearch` applies its per-strategy boost.
 */
function buildQueryMock(config: {
  exact?: any[]
  keyword?: any[]
  fuzzy?: any[]
  content?: any[]
  suggestions?: any[]
}) {
  return jest.fn(async (sql: string) => {
    // Fingerprints no longer key off a bare `LOWER(name)`/`name` substring:
    // every strategy now wraps the comparison in NORMALIZED_NAME_SQL
    // (design D2), so each strategy is identified by a part of its query
    // that NORMALIZED_NAME_SQL does not itself contain.
    if (sql.includes('1.0::float as score')) return config.exact ?? []
    if (sql.includes('fullKeywordCoverage')) return config.keyword ?? []
    if (sql.includes('% :query')) return config.fuzzy ?? []
    if (sql.includes(':exactQuery')) return config.content ?? []
    if (sql.includes('sim_score')) return config.suggestions ?? []
    throw new Error(`Unrecognized SQL in test mock: ${sql}`)
  })
}

function row(id: string, score: number, extra: Record<string, any> = {}) {
  return { id, name: `Place ${id}`, lat: 0, lng: 0, cityId: 'city-1', score, ...extra }
}

function makeRepository(config: Parameters<typeof buildQueryMock>[0]) {
  const query = buildQueryMock(config)
  const repository = new PlaceSearchRepository({ query } as any)
  return { repository, query }
}

function suggestionQueryWasCalled(query: jest.Mock): boolean {
  return query.mock.calls.some(([sql]: [string]) => sql.includes('sim_score'))
}

// ---------------------------------------------------------------------------
// Strong-candidate verdict
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository.searchWithSuggestions() - strong-candidate verdict', () => {
  it('literal match is strong', async () => {
    const { repository } = makeRepository({
      exact: [row('p1', 1.0)],
      fuzzy: [row('p2', 0.2)],
    })

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.hasStrongCandidate).toBe(true)
    expect(result.suggestions).toEqual([])
  })

  it('a dominant fuzzy match over a weak second result is strong', async () => {
    const { repository } = makeRepository({
      fuzzy: [row('p1', 0.8)], // 0.8 + 0.6 boost = 1.4
      content: [row('p2', 0.3)], // 0.3 + 0.4 boost = 0.7
    })

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.results[0].score).toBeCloseTo(1.4)
    expect(result.results[1].score).toBeCloseTo(0.7)
    expect(result.hasStrongCandidate).toBe(true)
  })

  it('a dominant low-coverage keyword match over a weak second result is NOT strong (keyword evidence gate)', async () => {
    // Regression test: a 1-of-2-keywords hit (0.5 base + 0.8 boost = 1.3) must not
    // clear the multi-result path just because the second candidate is weaker.
    const { repository } = makeRepository({
      keyword: [row('p1', 0.5, { fullKeywordCoverage: false })], // 0.5 + 0.8 = 1.3
      fuzzy: [row('p2', 0.2)], // 0.2 + 0.6 = 0.8
    })

    const result = await repository.searchWithSuggestions('parque libertad')

    expect(result.results[0].score).toBeCloseTo(1.3)
    expect(result.results[1].score).toBeCloseTo(0.8)
    expect(result.hasStrongCandidate).toBe(false)
  })

  it('near-tied candidates are not strong', async () => {
    const { repository } = makeRepository({
      fuzzy: [row('p1', 0.8), row('p2', 0.6)], // 1.4 and 1.2 -> ratio < 1.5
    })

    const result = await repository.searchWithSuggestions('estacion')

    expect(result.results[0].score).toBeCloseTo(1.4)
    expect(result.results[1].score).toBeCloseTo(1.2)
    expect(result.hasStrongCandidate).toBe(false)
  })

  it('a sole full-coverage keyword match at 1.8 is strong', async () => {
    const { repository } = makeRepository({
      keyword: [row('p1', 1.0, { fullKeywordCoverage: true })], // 1.0 + 0.8 = 1.8
    })

    const result = await repository.searchWithSuggestions('parque libertad')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBeCloseTo(1.8)
    expect(result.hasStrongCandidate).toBe(true)
  })

  it('a sole partial-coverage keyword match at 1.3 is NOT strong', async () => {
    const { repository } = makeRepository({
      keyword: [row('p1', 0.5, { fullKeywordCoverage: false })], // 0.5 + 0.8 = 1.3
    })

    const result = await repository.searchWithSuggestions('parque libertad')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBeCloseTo(1.3)
    expect(result.hasStrongCandidate).toBe(false)
  })

  it('a weak single result is not strong', async () => {
    const { repository } = makeRepository({
      fuzzy: [row('p1', 0.2)], // 0.2 + 0.6 = 0.8
    })

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBeCloseTo(0.8)
    expect(result.hasStrongCandidate).toBe(false)
  })

  it('no results is not strong', async () => {
    const { repository } = makeRepository({})

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.results).toEqual([])
    expect(result.hasStrongCandidate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Coverage-sensitive keyword scoring
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository.searchWithSuggestions() - coverage-sensitive keyword scoring', () => {
  it('full keyword coverage outscores partial coverage and each result keeps its own coverage flag', async () => {
    const { repository } = makeRepository({
      keyword: [
        row('pB', 0.5, { fullKeywordCoverage: false }), // 0.5 + 0.8 = 1.3
        row('pA', 1.0, { fullKeywordCoverage: true }), // 1.0 + 0.8 = 1.8
      ],
    })

    const result = await repository.searchWithSuggestions('parque libertad')

    expect(result.results.map((r) => r.id)).toEqual(['pA', 'pB'])
    expect(result.results[0].fullKeywordCoverage).toBe(true)
    expect(result.results[1].fullKeywordCoverage).toBe(false)
    expect(result.results[0].score).toBeGreaterThan(result.results[1].score)
  })
})

// ---------------------------------------------------------------------------
// Dedup metadata integrity
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository.searchWithSuggestions() - dedup metadata integrity', () => {
  it('a place matching via low keyword partial AND a higher fuzzy score keeps the fuzzy row search_type/coverage', async () => {
    // removeDuplicates must swap the ENTIRE row (score + search_type + fullKeywordCoverage
    // together), never just the score, so the verdict gate evaluates the metadata of the
    // strategy that actually produced the retained score.
    const { repository } = makeRepository({
      keyword: [row('p1', 0.5, { fullKeywordCoverage: false })], // 0.5 + 0.8 = 1.3
      fuzzy: [row('p1', 0.9)], // 0.9 + 0.6 = 1.5
    })

    const result = await repository.searchWithSuggestions('parque libertad')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBeCloseTo(1.5)
    expect(result.results[0].search_type).toBe('fuzzy')
    expect(result.results[0].fullKeywordCoverage).toBeUndefined()
    // Sole-result path at 1.5: qualifies as strong only because the winning row is
    // 'fuzzy' (gate-exempt). Had the stale keyword metadata leaked through, the gate
    // would have wrongly vetoed this as a partial-coverage keyword match.
    expect(result.hasStrongCandidate).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Numeric-string score coercion (Postgres `numeric` columns/literals come
// back from node-postgres as strings; exactSearch/contentSearch select
// numeric literals, so their rows arrive as string scores from the DB even
// though the TS type claims `number`). Regression coverage must use string
// scores in the mock to reproduce the real failure mode: string + number
// concatenates instead of adding.
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository.smartSearch() - numeric-string score coercion', () => {
  it('a string-scored exact match totals 2.0 and outranks a keyword hit on the same place', async () => {
    const { repository } = makeRepository({
      // exactSearch's `1.0 as score` literal comes back from Postgres as the
      // string '1.0', while keywordSearch's `::float` cast already produces
      // a genuine number — this asymmetry is exactly what causes the bug.
      exact: [row('p1', '1.0' as any)],
      keyword: [row('p1', 0.5, { fullKeywordCoverage: false })], // 0.5 + 0.8 = 1.3
    })

    const result = await repository.searchWithSuggestions('puerto madero')

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBe(2.0)
    expect(result.results[0].search_type).toBe('exact')
  })

  it('a literal catalog-name query is a strong candidate and the exact search_type survives removeDuplicates', async () => {
    const { repository } = makeRepository({
      exact: [row('p1', '1.0' as any)],
      keyword: [row('p1', 0.5, { fullKeywordCoverage: false })],
    })

    const result = await repository.searchWithSuggestions('puerto madero')

    expect(result.hasStrongCandidate).toBe(true)
    expect(result.results[0].search_type).toBe('exact')
  })

  it('a string-scored content match survives the minScore filter instead of becoming NaN', async () => {
    const { repository } = makeRepository({
      content: [row('p1', '0.9' as any)], // Number('0.9') + 0.4 = 1.3
    })

    const result = await repository.searchWithSuggestions('puerto madero', { minScore: 0.2 })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].score).toBeCloseTo(1.3)
    expect(Number.isNaN(result.results[0].score)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Suggestions skipped for strong candidates
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository.searchWithSuggestions() - suggestions gating', () => {
  it('does not run the suggestion query when the verdict is strong', async () => {
    const { repository, query } = makeRepository({
      exact: [row('p1', 1.0)],
    })

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.hasStrongCandidate).toBe(true)
    expect(result.suggestions).toEqual([])
    expect(suggestionQueryWasCalled(query)).toBe(false)
  })

  it('runs the suggestion query when the verdict is not strong', async () => {
    const { repository, query } = makeRepository({
      fuzzy: [row('p1', 0.2)], // 0.8, not strong
      suggestions: [{ id: 's1', name: 'Suggested Place', sim_score: 0.4 }],
    })

    const result = await repository.searchWithSuggestions('unicentro')

    expect(result.hasStrongCandidate).toBe(false)
    expect(suggestionQueryWasCalled(query)).toBe(true)
    expect(result.suggestions).toEqual([{ id: 's1', name: 'Suggested Place' }])
  })
})

// ---------------------------------------------------------------------------
// Accent-insensitive SQL (design D2, fix-chatbot-unsupported-search-and-double-assigned)
// ---------------------------------------------------------------------------

describe('PlaceSearchRepository - accent-insensitive SQL (design D2)', () => {
  it('every generated query compares against NORMALIZED_NAME_SQL and never a bare LOWER(name)', async () => {
    const collectedSql: string[] = []
    const query = jest.fn(async (sql: string) => {
      collectedSql.push(sql)
      return []
    })
    const repository = new PlaceSearchRepository({ query } as any)

    // 'tizon rojo' has two >2-char, non-stopword keywords, so keywordSearch
    // issues a query too; an all-empty result set is not a strong candidate,
    // so generateSuggestions also runs. That's all 5 strategies covered.
    await repository.searchWithSuggestions('tizon rojo')

    expect(collectedSql.length).toBe(5)
    for (const sql of collectedSql) {
      expect(sql).toContain(NORMALIZED_NAME_SQL)
      expect(sql).not.toContain('LOWER(name)')
      expect(sql).not.toContain('name % :query')
    }
  })
})

describe('PlaceSearchRepository - NORMALIZED_NAME_SQL translate() table integrity', () => {
  function parseTranslateTable(): [string, string] {
    const match = NORMALIZED_NAME_SQL.match(/translate\(name, '([^']+)', '([^']+)'\)/)
    if (!match) throw new Error('NORMALIZED_NAME_SQL does not contain a translate() call')
    return [match[1], match[2]]
  }

  it('has equal-length from/to character tables', () => {
    const [from, to] = parseTranslateTable()
    expect(from.length).toBe(to.length)
  })

  it('folds every character in the translate() from-table the same way normalizeQuery does', () => {
    const [from, to] = parseTranslateTable()
    const { repository } = makeRepository({})
    // normalizeQuery is private; this reaches it directly so the test is
    // tied to the real folding logic instead of a re-asserted duplicate.
    const normalizeQuery = (repository as any).normalizeQuery.bind(repository)

    for (let i = 0; i < from.length; i++) {
      const char = from[i]
      const expectedFold = to[i].toLowerCase()
      expect(normalizeQuery(char)).toBe(expectedFold)
    }
  })
})
