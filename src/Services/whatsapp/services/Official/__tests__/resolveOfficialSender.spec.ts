import {
  resolveOfficialSender,
  extractAttestedPhone,
  WebhookMessage,
  WebhookContact,
} from '../resolveOfficialSender'

describe('resolveOfficialSender', () => {
  it('case A: from present, valueContacts absent', () => {
    const message: WebhookMessage = { id: 'wamid.1', from: '573001234567', type: 'text' }

    const result = resolveOfficialSender(message, undefined, () => undefined)

    expect(result).toEqual({
      phone: '573001234567',
      userId: undefined,
      profileName: undefined,
      source: 'from',
    })
  })

  it('case B: from absent, a single value.contacts[] entry with wa_id', () => {
    const message: WebhookMessage = { id: 'wamid.2', type: 'text' }
    const valueContacts: WebhookContact[] = [{ wa_id: '573009999999', profile: { name: 'Case B' } }]

    const result = resolveOfficialSender(message, valueContacts, () => undefined)

    expect(result).toEqual({
      phone: '573009999999',
      userId: undefined,
      profileName: 'Case B',
      source: 'contacts_wa_id',
    })
  })

  it('case B: multiple valueContacts matched by user_id', () => {
    const message: WebhookMessage = {
      id: 'wamid.3',
      from_user_id: 'CO.4510540692592955',
      type: 'text',
    }
    const valueContacts: WebhookContact[] = [
      { wa_id: '573001111111', user_id: 'CO.other', profile: { name: 'Other' } },
      {
        wa_id: '573002222222',
        user_id: 'CO.4510540692592955',
        profile: { name: 'Matched' },
      },
    ]

    const result = resolveOfficialSender(message, valueContacts, () => undefined)

    expect(result).toEqual({
      phone: '573002222222',
      userId: 'CO.4510540692592955',
      profileName: 'Matched',
      source: 'contacts_wa_id',
    })
  })

  it('case C: from and valueContacts[].wa_id both absent, lookup resolves a phone', () => {
    const message: WebhookMessage = {
      id: 'wamid.4',
      from_user_id: 'CO.4510540692592955',
      type: 'text',
    }

    const lookup = jest.fn().mockReturnValue({ phone: '573003333333' })
    const result = resolveOfficialSender(message, undefined, lookup)

    expect(lookup).toHaveBeenCalledWith('CO.4510540692592955')
    expect(result).toEqual({
      phone: '573003333333',
      userId: 'CO.4510540692592955',
      profileName: undefined,
      source: 'store',
    })
  })

  it('case D: nothing resolves', () => {
    const message: WebhookMessage = {
      id: 'wamid.5',
      from_user_id: 'CO.unknown',
      type: 'text',
    }

    const result = resolveOfficialSender(message, undefined, () => undefined)

    expect(result).toEqual({ source: 'none' })
    expect(result.phone).toBeUndefined()
    expect(result.userId).toBeUndefined()
  })

  describe('extractAttestedPhone', () => {
    it('returns the wa_id digits for a contact_request entry', () => {
      const message: WebhookMessage = {
        id: 'wamid.6',
        type: 'contacts',
        contacts: [
          {
            origin: 'contact_request',
            phones: [{ wa_id: '573001234567', phone: '+57 300 123 4567', type: 'CELL' }],
          },
        ],
      }

      expect(extractAttestedPhone(message)).toBe('573001234567')
    })

    it('falls back to phone digits when wa_id is absent', () => {
      const message: WebhookMessage = {
        id: 'wamid.7',
        type: 'contacts',
        contacts: [
          {
            origin: 'contact_request',
            phones: [{ phone: '+57 300 987 6543', type: 'CELL' }],
          },
        ],
      }

      expect(extractAttestedPhone(message)).toBe('573009876543')
    })

    it('returns undefined when only an other-origin entry exists', () => {
      const message: WebhookMessage = {
        id: 'wamid.8',
        type: 'contacts',
        contacts: [
          {
            origin: 'other',
            phones: [{ wa_id: '573001234567', phone: '+573001234567' }],
          },
        ],
      }

      expect(extractAttestedPhone(message)).toBeUndefined()
    })

    it('returns undefined when message.contacts is empty or absent', () => {
      expect(
        extractAttestedPhone({ id: 'wamid.9', type: 'contacts', contacts: [] })
      ).toBeUndefined()
      expect(extractAttestedPhone({ id: 'wamid.10', type: 'contacts' })).toBeUndefined()
    })
  })
})
