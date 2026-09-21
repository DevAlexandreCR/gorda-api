import { Interactive } from '../services/Official/Constants/Interactive'
import { InteractiveReply } from '../services/Official/Constants/InteractiveReply'

type RenderedOption = { id: string; title: string; description?: string }

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeForComparison(value: string): string {
  return stripDiacritics(value.trim().toLowerCase())
}

// Mirrors renderInteractiveAsText.ts's numbering (task 4.2): for a `list`, numbering
// continues across sections; for a `button`, buttons are taken in array order.
function collectRenderedOptions(interactive: Interactive): RenderedOption[] {
  const options: RenderedOption[] = []

  if (interactive.type === 'button') {
    for (const button of interactive.action.buttons ?? []) {
      if (!button.reply) continue
      options.push({ id: button.reply.id, title: button.reply.title })
    }
  } else if (interactive.type === 'list') {
    for (const section of interactive.action.sections ?? []) {
      for (const row of section.rows) {
        options.push({ id: row.id, title: row.title, description: row.description })
      }
    }
  }

  return options
}

// Matches only an exact ordinal (`n`, `n.` or `n)`) within the offered range; a leading
// digit followed by anything else (e.g. "2 gracias") is not an ordinal (design D4).
function matchOrdinal(trimmed: string, optionCount: number): number | null {
  const match = /^(\d+)[.)]?$/.exec(trimmed)
  if (!match) return null

  const n = Number(match[1])
  if (!Number.isInteger(n) || n < 1 || n > optionCount) return null

  return n
}

function toInteractiveReply(interactive: Interactive, option: RenderedOption): InteractiveReply {
  if (interactive.type === 'button') {
    return {
      type: 'button_reply',
      button_reply: { id: option.id, title: option.title },
    }
  }

  return {
    type: 'list_reply',
    list_reply: {
      id: option.id,
      title: option.title,
      ...(option.description !== undefined ? { description: option.description } : {}),
    },
  }
}

// Design D3/D4: a text is a pick only when its trimmed content is exactly the ordinal
// of an offered option, or a case/accent-insensitive match of an option's title.
// Anything else (extra words, no options offered, an ordinal outside the range) stays
// TEXT — prefix matching is deliberately rejected because the 5-second debounce merges
// text turns by joining bodies with spaces ("2 gracias, ya no" must not become a pick).
export function resolveInteractiveOption(
  text: string,
  interactive: Interactive | null
): InteractiveReply | null {
  if (!interactive || (interactive.type !== 'button' && interactive.type !== 'list')) {
    return null
  }

  const options = collectRenderedOptions(interactive)
  if (options.length === 0) return null

  const trimmed = text.trim()
  const ordinal = matchOrdinal(trimmed, options.length)

  const matched =
    ordinal !== null
      ? options[ordinal - 1]
      : options.find(
          (option) => normalizeForComparison(option.title) === normalizeForComparison(trimmed)
        )

  return matched ? toInteractiveReply(interactive, matched) : null
}
