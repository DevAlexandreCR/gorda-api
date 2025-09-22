import { PlaceInterface } from '../Interfaces/PlaceInterface'
import { Sequelize, QueryTypes, Op } from 'sequelize'
import Place from '../Models/Place'

interface SearchResult extends PlaceInterface {
  score: number
  search_type: string
}

interface SearchOptions {
  cityId?: string
  limit?: number
  minScore?: number
}

class PlaceSearchRepository {
  private sequelize: Sequelize

  constructor(sequelizeInstance: Sequelize) {
    this.sequelize = sequelizeInstance
  }

  /**
   * Smart search combining multiple strategies
   */
  async smartSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { cityId, limit = 5, minScore = 0.3 } = options
    const normalizedQuery = this.normalizeQuery(query)

    try {
      const exactMatch = await this.exactSearch(normalizedQuery, cityId)
      
      const keywordMatch = await this.keywordSearch(normalizedQuery, cityId)
      
      const fuzzyMatch = await this.fuzzySearch(normalizedQuery, cityId)
      
      const contentMatch = await this.contentSearch(normalizedQuery, cityId)

      const allResults = [
        ...exactMatch.map(r => ({ ...r, score: r.score + 1.0, search_type: 'exact' })),
        ...keywordMatch.map(r => ({ ...r, score: r.score + 0.8, search_type: 'keyword' })),
        ...fuzzyMatch.map(r => ({ ...r, score: r.score + 0.6, search_type: 'fuzzy' })),
        ...contentMatch.map(r => ({ ...r, score: r.score + 0.4, search_type: 'content' }))
      ]

      const uniqueResults = this.removeDuplicates(allResults)
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return uniqueResults
    } catch (error) {
      console.error('Error in smartSearch:', error, 'Query:', query, 'Options:', options)
      throw error
    }
  }

  /**
   * Exact search - perfect match
   */
  private async exactSearch(query: string, cityId?: string): Promise<SearchResult[]> {
    const whereClause = cityId ? 'AND city_id = :cityId' : ''
    
    const sql = `
      SELECT id, name, lat, lng, city_id, 1.0 as score
      FROM "places"
      WHERE LOWER(name) = LOWER(:query)
      ${whereClause}
    `

    return await this.sequelize.query<SearchResult>(sql, {
      replacements: { query, cityId },
      type: QueryTypes.SELECT,
    })
  }

  /**
   * Search by important keywords
   */
  private async keywordSearch(query: string, cityId?: string): Promise<SearchResult[]> {
    const keywords = this.extractKeywords(query)
    if (keywords.length === 0) return []

    const whereClause = cityId ? 'AND city_id = :cityId' : ''
    const keywordConditions = keywords.map((_, i) => `LOWER(name) LIKE LOWER(:keyword${i})`).join(' OR ')

    const sql = `
      SELECT id, name, lat, lng, city_id, 
             :keywordScore as score
      FROM "places"
      WHERE (${keywordConditions})
      ${whereClause}
    `

    const replacements: any = { 
      cityId, 
      keywordScore: keywords.length > 0 ? (1.0 / keywords.length) : 0.5 
    }
    keywords.forEach((keyword, i) => {
      replacements[`keyword${i}`] = `%${keyword}%`
    })

    return await this.sequelize.query<SearchResult>(sql, {
      replacements,
      type: QueryTypes.SELECT,
    })
  }

  /**
   * Fuzzy search with similarity (improved from current implementation)
   */
  private async fuzzySearch(query: string, cityId?: string): Promise<SearchResult[]> {
    const whereClause = cityId ? 'AND city_id = :cityId' : ''
    
    const sql = `
      SELECT id, name, lat, lng, city_id, similarity(name, :query) AS score
      FROM "places"
      WHERE name % :query
      ${whereClause}
      AND similarity(name, :query) > 0.2
    `

    try {
      return await this.sequelize.query<SearchResult>(sql, {
        replacements: { query, cityId },
        type: QueryTypes.SELECT,
      })
    } catch (error) {
      console.error('Error in fuzzySearch:', error, 'Query:', query, 'CityId:', cityId)
      throw error
    }
  }

  /**
   * Content search with ILIKE
   */
  private async contentSearch(query: string, cityId?: string): Promise<SearchResult[]> {
    const whereClause = cityId ? 'AND city_id = :cityId' : ''
    
    const sql = `
      SELECT id, name, lat, lng, city_id, 
             CASE 
               WHEN LOWER(name) LIKE LOWER(:exactQuery) THEN 0.9
               WHEN LOWER(name) LIKE LOWER(:startQuery) THEN 0.7
               WHEN LOWER(name) LIKE LOWER(:containsQuery) THEN 0.5
               ELSE 0.3
             END as score
      FROM "places"
      WHERE LOWER(name) LIKE LOWER(:containsQuery)
      ${whereClause}
    `

    return await this.sequelize.query<SearchResult>(sql, {
      replacements: { 
        exactQuery: query,
        startQuery: `${query}%`,
        containsQuery: `%${query}%`,
        cityId 
      },
      type: QueryTypes.SELECT,
    })
  }

  /**
   * Normalize search query
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/[áàäâ]/g, 'a')
      .replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i')
      .replace(/[óòöô]/g, 'o')
      .replace(/[úùüû]/g, 'u')
      .replace(/ñ/g, 'n')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
  }

  /**
   * Extract important keywords
   */
  private extractKeywords(query: string): string[] {
    const stopWords = ['el', 'la', 'de', 'del', 'centro', 'comercial', 'para', 'un', 'una', 'en']
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word))
      .slice(0, 3)
  }

  /**
   * Remove duplicate results keeping best score
   */
  private removeDuplicates(results: SearchResult[]): SearchResult[] {
    const unique = new Map<string, SearchResult>()
    
    for (const result of results) {
      const existing = unique.get(result.id)
      if (!existing || result.score > existing.score) {
        unique.set(result.id, result)
      }
    }
    
    return Array.from(unique.values())
  }

  /**
   * Search with alternative suggestions
   */
  async searchWithSuggestions(query: string, options: SearchOptions = {}): Promise<{
    results: SearchResult[]
    suggestions: Array<{id: string, name: string}>
    hasExactMatch: boolean
  }> {
    const results = await this.smartSearch(query, options)
    const hasExactMatch = results.some(r => r.search_type === 'exact')
    
    const suggestions = hasExactMatch ? [] : await this.generateSuggestions(query, options.cityId)
    
    return {
      results,
      suggestions,
      hasExactMatch
    }
  }

  /**
   * Generate alternative suggestions
   */
  private async generateSuggestions(query: string, cityId?: string): Promise<Array<{id: string, name: string}>> {
    const whereClause = cityId ? 'AND city_id = :cityId' : ''
    
    const sql = `
      SELECT DISTINCT id, name, similarity(name, :query) as sim_score
      FROM "places"
      WHERE similarity(name, :query) > 0.1
      ${whereClause}
      ORDER BY sim_score DESC
      LIMIT 5
    `

    try {
      const results = await this.sequelize.query<{id: string, name: string, sim_score: number}>(sql, {
        replacements: { query, cityId },
        type: QueryTypes.SELECT,
      })
      
      return results.map(r => ({ id: r.id, name: r.name }))
    } catch (error) {
      console.error('Error in generateSuggestions:', error, 'Query:', query, 'CityId:', cityId)
      return []
    }
  }
}

export default PlaceSearchRepository