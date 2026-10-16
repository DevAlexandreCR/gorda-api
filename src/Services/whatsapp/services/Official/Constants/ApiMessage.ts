import { Interactive } from './Interactive'

export type ApiMessage = {
  messaging_product: string
  to: string
  type: 'INTERACTIVE' | 'LOCATION' | 'TEXT' | 'LINK_PREVIEW'
  text: {
    body: string
  }
  interactive?: Interactive
}

// Distinct payload shape used when Meta identifies the recipient by a
// Business-Scoped User ID (BSUID) rather than a phone number: `recipient`
// replaces `to`, and both must never be set on the same payload (if they
// are, `to` wins). Used by OfficialClient.requestContactInfo.
export type ApiRecipientMessage = {
  messaging_product: string
  recipient_type: 'individual'
  recipient: string
  type: 'interactive'
  interactive: Interactive
}
