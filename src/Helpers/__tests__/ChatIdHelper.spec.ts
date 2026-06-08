import ChatIdHelper from '../ChatIdHelper'

describe('ChatIdHelper.toCanonicalClientId', () => {
  describe('valid inputs — returns canonical digits-only string', () => {
    it('plain digits', () => {
      expect(ChatIdHelper.toCanonicalClientId('573001234567')).toBe('573001234567')
    })

    it('+digits', () => {
      expect(ChatIdHelper.toCanonicalClientId('+573001234567')).toBe('573001234567')
    })

    it('digits@c.us', () => {
      expect(ChatIdHelper.toCanonicalClientId('573001234567@c.us')).toBe('573001234567')
    })

    it('digits@s.whatsapp.net', () => {
      expect(ChatIdHelper.toCanonicalClientId('573001234567@s.whatsapp.net')).toBe('573001234567')
    })

    it('+digits@c.us', () => {
      expect(ChatIdHelper.toCanonicalClientId('+573001234567@c.us')).toBe('573001234567')
    })

    it('+digits@s.whatsapp.net', () => {
      expect(ChatIdHelper.toCanonicalClientId('+573001234567@s.whatsapp.net')).toBe('573001234567')
    })

    it('whitespace-padded digits@c.us', () => {
      expect(ChatIdHelper.toCanonicalClientId('  573001234567@c.us  ')).toBe('573001234567')
    })
  })

  describe('invalid inputs — throws', () => {
    it('empty string', () => {
      expect(() => ChatIdHelper.toCanonicalClientId('')).toThrow()
    })

    it('whitespace-only string', () => {
      expect(() => ChatIdHelper.toCanonicalClientId('   ')).toThrow()
    })

    it('null (cast to string)', () => {
      expect(() => ChatIdHelper.toCanonicalClientId(null as unknown as string)).toThrow()
    })

    it('undefined (cast to string)', () => {
      expect(() => ChatIdHelper.toCanonicalClientId(undefined as unknown as string)).toThrow()
    })

    it('alphanumeric residue: "abc"', () => {
      expect(() => ChatIdHelper.toCanonicalClientId('abc')).toThrow()
    })

    it('alphanumeric residue: "57x001234567"', () => {
      expect(() => ChatIdHelper.toCanonicalClientId('57x001234567')).toThrow()
    })

    it('alphanumeric residue: "+abc@c.us"', () => {
      expect(() => ChatIdHelper.toCanonicalClientId('+abc@c.us')).toThrow()
    })
  })
})
