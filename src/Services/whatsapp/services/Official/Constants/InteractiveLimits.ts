import { Interactive } from './Interactive'

// WhatsApp Cloud API caps on interactive payload fields (Meta developer docs,
// developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
// and interactive-reply-buttons-messages, verified 2026-09-21). Baileys has no such
// limit and renders the same payload as plain text (see WhatsAppClient/renderInteractiveAsText),
// so this cap belongs to the Official transport, not the shared message builder.
const ROW_TITLE_MAX = 24
const ROW_DESCRIPTION_MAX = 72
const SECTION_TITLE_MAX = 24
const LIST_BUTTON_MAX = 20
const REPLY_TITLE_MAX = 20
const HEADER_TEXT_MAX = 60
const FOOTER_TEXT_MAX = 60
const BODY_TEXT_MAX = 1024

const ELLIPSIS = '…'

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }
  return value.slice(0, max - ELLIPSIS.length) + ELLIPSIS
}

function truncateOptional(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : truncate(value, max)
}

// Returns a sanitized copy of `interactive` with every field clamped to the
// WhatsApp Cloud API limits above. Never mutates the input: the caller also
// persists the original object to the message log.
export function sanitizeInteractiveForOfficial(interactive: Interactive): Interactive {
  const sanitized: Interactive = { ...interactive }

  if (sanitized.body) {
    sanitized.body = { ...sanitized.body, text: truncate(sanitized.body.text, BODY_TEXT_MAX) }
  }

  if (sanitized.header) {
    sanitized.header = { ...sanitized.header, text: truncate(sanitized.header.text, HEADER_TEXT_MAX) }
  }

  if (sanitized.footer) {
    sanitized.footer = { ...sanitized.footer, text: truncate(sanitized.footer.text, FOOTER_TEXT_MAX) }
  }

  if (sanitized.action) {
    const action = { ...sanitized.action }

    if (action.button !== undefined) {
      action.button = truncate(action.button, LIST_BUTTON_MAX)
    }

    if (action.sections) {
      action.sections = action.sections.map((section) => ({
        ...section,
        title: truncateOptional(section.title, SECTION_TITLE_MAX),
        rows: section.rows.map((row) => ({
          ...row,
          title: truncate(row.title, ROW_TITLE_MAX),
          description: truncateOptional(row.description, ROW_DESCRIPTION_MAX),
        })),
      }))
    }

    if (action.buttons) {
      action.buttons = action.buttons.map((button) => ({
        ...button,
        reply: button.reply
          ? { ...button.reply, title: truncate(button.reply.title, REPLY_TITLE_MAX) }
          : button.reply,
      }))
    }

    sanitized.action = action
  }

  return sanitized
}
