import { normalizePlate } from '../PlateHelper'

describe('normalizePlate', () => {
  describe('lowercases and removes spaces', () => {
    it('"abc 123" → "ABC123"', () => {
      expect(normalizePlate('abc 123')).toBe('ABC123')
    })

    it('"ABC 123" → "ABC123"', () => {
      expect(normalizePlate('ABC 123')).toBe('ABC123')
    })
  })

  describe('removes dashes', () => {
    it('"abc-123" → "ABC123"', () => {
      expect(normalizePlate('abc-123')).toBe('ABC123')
    })
  })

  describe('removes spaces and dashes combined', () => {
    it('"abc - 123" → "ABC123"', () => {
      expect(normalizePlate('abc - 123')).toBe('ABC123')
    })
  })

  describe('already normalized inputs', () => {
    it('"ABC123" → "ABC123"', () => {
      expect(normalizePlate('ABC123')).toBe('ABC123')
    })

    it('"XYZ999" → "XYZ999"', () => {
      expect(normalizePlate('XYZ999')).toBe('XYZ999')
    })
  })

  describe('edge cases', () => {
    it('empty string → ""', () => {
      expect(normalizePlate('')).toBe('')
    })
  })
})
