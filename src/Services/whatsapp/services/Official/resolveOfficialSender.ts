// Pure resolver: the BSUID -> phone lookup is injected by the caller rather than imported,
// so this module has no dependency on Store and stays trivially unit-testable.

// value.contacts[] — the payload-level array delivered alongside messages[]. Used ONLY by
// the sender resolution order (case B below). Never conflate with WebhookContactCard.
export type WebhookContact = {
  wa_id?: string
  user_id?: string
  profile?: { name?: string; username?: string }
}

// messages[].contacts[] — the per-message array that appears on a `type: 'contacts'` reply
// (the phone-share response to our own request_contact_info prompt). Used ONLY by
// extractAttestedPhone. Never conflate with WebhookContact.
export type WebhookContactCard = {
  origin?: 'contact_request' | 'other'
  phones?: Array<{ phone?: string; wa_id?: string; type?: string }>
  name?: { formatted_name?: string }
}

export type WebhookMessage = {
  id: string
  timestamp?: number | string
  from?: string
  from_user_id?: string
  type?: string
  text?: { body?: string }
  location?: { name?: string; latitude: number; longitude: number }
  interactive?: any
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string }
  contacts?: WebhookContactCard[]
}

export type ResolvedSender = {
  phone?: string
  userId?: string
  profileName?: string
  source: 'from' | 'contacts_wa_id' | 'store' | 'none'
}

function matchValueContact(
  message: WebhookMessage,
  valueContacts: WebhookContact[] | undefined
): WebhookContact | undefined {
  if (!valueContacts || valueContacts.length === 0) {
    return undefined
  }

  if (message.from_user_id) {
    const byUserId = valueContacts.find((contact) => contact.user_id === message.from_user_id)
    if (byUserId) {
      return byUserId
    }
  }

  if (message.from) {
    const byWaId = valueContacts.find((contact) => contact.wa_id === message.from)
    if (byWaId) {
      return byWaId
    }
  }

  if (valueContacts.length === 1) {
    return valueContacts[0]
  }

  return undefined
}

export function resolveOfficialSender(
  message: WebhookMessage,
  valueContacts: WebhookContact[] | undefined,
  lookup: (userId: string) => { phone: string } | undefined
): ResolvedSender {
  // A. `message.from` present — use it directly.
  if (message.from) {
    const matched = matchValueContact(message, valueContacts)
    return {
      phone: message.from,
      userId: message.from_user_id,
      profileName: matched?.profile?.name,
      source: 'from',
    }
  }

  // B. `from` absent, a matching `value.contacts[]` entry carries a `wa_id`.
  const matched = matchValueContact(message, valueContacts)
  if (matched?.wa_id) {
    return {
      phone: matched.wa_id,
      userId: message.from_user_id ?? matched.user_id,
      profileName: matched.profile?.name,
      source: 'contacts_wa_id',
    }
  }

  // C. `from` and contact `wa_id` both absent — fall back to a previously linked BSUID.
  if (message.from_user_id) {
    const stored = lookup(message.from_user_id)
    if (stored?.phone) {
      return {
        phone: stored.phone,
        userId: message.from_user_id,
        profileName: matched?.profile?.name,
        source: 'store',
      }
    }
  }

  // D. Nothing resolves — the caller must not guess a phone/client id.
  return { source: 'none' }
}

function extractDigits(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const digits = value.replace(/\D/g, '')
  return digits.length > 0 ? digits : undefined
}

export function extractAttestedPhone(message: WebhookMessage): string | undefined {
  const cards = message.contacts
  if (!cards || cards.length === 0) {
    return undefined
  }

  const attested = cards.find((card) => card.origin === 'contact_request')
  if (!attested) {
    return undefined
  }

  const phone = attested.phones?.find((entry) => entry.wa_id || entry.phone)
  if (!phone) {
    return undefined
  }

  return extractDigits(phone.wa_id) ?? extractDigits(phone.phone)
}
