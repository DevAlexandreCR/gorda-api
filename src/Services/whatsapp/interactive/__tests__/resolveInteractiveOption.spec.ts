import { resolveInteractiveOption } from '../resolveInteractiveOption'
import { Interactive } from '../../services/Official/Constants/Interactive'

const buttonInteractive: Interactive = {
  type: 'button',
  action: {
    buttons: [
      { type: 'reply', reply: { id: 'CANCEL', title: 'Cancelar' } },
      { type: 'reply', reply: { id: 'INSIST', title: 'Insistir' } },
    ],
  },
}

const listInteractive: Interactive = {
  type: 'list',
  action: {
    sections: [
      {
        title: 'Seccion 1',
        rows: [
          { id: 'A', title: 'Fila A' },
          { id: 'B', title: 'Fila B' },
        ],
      },
      {
        title: 'Seccion 2',
        rows: [{ id: 'C', title: 'Fila C' }],
      },
    ],
  },
}

describe('resolveInteractiveOption (spec: wp-interactive-fallback - Plain-text option picks are promoted to interactive replies)', () => {
  it('Ordinal pick: "1" resolves to the first button', () => {
    const result = resolveInteractiveOption('1', buttonInteractive)

    expect(result).toEqual({
      type: 'button_reply',
      button_reply: { id: 'CANCEL', title: 'Cancelar' },
    })
  })

  it('accepts the "n." and "n)" ordinal spellings', () => {
    expect(resolveInteractiveOption('2.', buttonInteractive)?.button_reply?.id).toBe('INSIST')
    expect(resolveInteractiveOption('2)', buttonInteractive)?.button_reply?.id).toBe('INSIST')
  })

  it('Title pick: a case/accent-insensitive title match resolves to that button', () => {
    const result = resolveInteractiveOption('insistir', buttonInteractive)

    expect(result).toEqual({
      type: 'button_reply',
      button_reply: { id: 'INSIST', title: 'Insistir' },
    })
  })

  it('strips diacritics for the title match (accent-insensitive)', () => {
    const accented: Interactive = {
      type: 'button',
      action: {
        buttons: [{ type: 'reply', reply: { id: 'YES', title: 'Sí' } }],
      },
    }

    expect(resolveInteractiveOption('si', accented)?.button_reply?.id).toBe('YES')
    expect(resolveInteractiveOption(' SI ', accented)?.button_reply?.id).toBe('YES')
  })

  it('List pick becomes a list reply: numbering continues across sections', () => {
    const result = resolveInteractiveOption('3', listInteractive)

    expect(result).toEqual({
      type: 'list_reply',
      list_reply: { id: 'C', title: 'Fila C' },
    })
  })

  it('Extra words are not a pick: "2 gracias" does not match any option', () => {
    expect(resolveInteractiveOption('2 gracias', buttonInteractive)).toBeNull()
  })

  it('an ordinal outside the offered range does not match', () => {
    expect(resolveInteractiveOption('3', buttonInteractive)).toBeNull()
    expect(resolveInteractiveOption('0', buttonInteractive)).toBeNull()
  })

  it('Options superseded by a later plain message: no interactive payload means no pick', () => {
    expect(resolveInteractiveOption('1', null)).toBeNull()
  })

  it('a location_request_message interactive (no buttons/rows) never matches', () => {
    const locationRequest: Interactive = {
      type: 'location_request_message',
      action: {},
    }

    expect(resolveInteractiveOption('1', locationRequest)).toBeNull()
  })
})
