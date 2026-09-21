import { ChatBotMessage } from '../../../Types/ChatBotMessage'

// Design D3: Baileys has no native reply-button/list send primitive, so a catalog
// message's `interactive` payload is rendered as plain numbered text instead. The
// Official transport keeps sending the native `interactive` payload unchanged and
// never calls this helper.
export function renderInteractiveAsText(message: ChatBotMessage): string {
  const interactive = message.interactive
  if (!interactive || interactive.type === 'location_request_message') {
    return message.message
  }

  const lines: string[] = []
  if (interactive.header?.text) {
    lines.push(interactive.header.text)
  }
  lines.push(message.message)
  lines.push('')

  let n = 1
  if (interactive.type === 'button') {
    for (const button of interactive.action.buttons ?? []) {
      if (!button.reply) {
        continue
      }
      lines.push(`${n}. ${button.reply.title}`)
      n++
    }
  } else if (interactive.type === 'list') {
    for (const section of interactive.action.sections ?? []) {
      if (section.title) {
        lines.push(section.title)
      }
      for (const row of section.rows) {
        const title = row.description ? `${row.title} - ${row.description}` : row.title
        lines.push(`${n}. ${title}`)
        n++
      }
    }
  }

  if (interactive.footer?.text) {
    lines.push(interactive.footer.text)
  }

  return lines.join('\n')
}
