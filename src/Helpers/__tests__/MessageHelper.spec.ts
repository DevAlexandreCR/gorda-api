import MessageHelper from '../MessageHelper'

describe('MessageHelper.isCourtesyMessage', () => {
  // Golden cases reproduced live against the chatBot (Baileys) line: the pre-existing
  // unbounded bigram scan classified any message CONTAINING "por favor" (or any other
  // courtesy bigram) as pure courtesy, silently dropping real customer intent before it
  // ever reached the chatbot. isCourtesyMessage must now mean "nothing but courtesy".
  describe('live repro golden cases (corrected expectations)', () => {
    it('a full service request ending in "por favor" is NOT courtesy', () => {
      expect(
        MessageHelper.isCourtesyMessage(
          'Hola un servicio para puerto mader porfa sin acompañante por favor'
        )
      ).toBe(false)
    })

    it('a full service request ending in "por favor" is NOT courtesy (second example)', () => {
      expect(MessageHelper.isCourtesyMessage('Necesito un taxi en el centro por favor')).toBe(
        false
      )
    })

    it('"Si" alone is genuinely pure courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('Si')).toBe(true)
    })

    it('a bare "Hola" is NOT courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('Hola')).toBe(false)
    })

    it('a place-only message is NOT courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('Un servicio para Puerto Madero')).toBe(false)
    })

    it('a pickup request with "porfa" is NOT courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('Recogeme en Campanario porfa')).toBe(false)
    })
  })

  describe('mixed content + courtesy (courtesy word must not mask real content)', () => {
    it('courtesy word at the start, content after', () => {
      expect(MessageHelper.isCourtesyMessage('Gracias, necesito un taxi en el centro')).toBe(
        false
      )
    })

    it('courtesy word in the middle, content on both sides', () => {
      expect(
        MessageHelper.isCourtesyMessage('Necesito un taxi porfa para el aeropuerto')
      ).toBe(false)
    })

    it('courtesy word at the end, content before it', () => {
      expect(MessageHelper.isCourtesyMessage('Recogeme en la estacion por favor')).toBe(false)
    })
  })

  describe('pure short-courtesy cases (existing behavior, kept passing)', () => {
    it('"ok gracias" is pure courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('ok gracias')).toBe(true)
    })

    it('"dale listo" is pure courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('dale listo')).toBe(true)
    })

    it('"esta bien" is pure courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('esta bien')).toBe(true)
    })

    it('a typo of a courtesy term still matches via fuzzy similarity', () => {
      expect(MessageHelper.isCourtesyMessage('grasias')).toBe(true)
    })

    it('empty message is not courtesy', () => {
      expect(MessageHelper.isCourtesyMessage('')).toBe(false)
    })
  })
})
