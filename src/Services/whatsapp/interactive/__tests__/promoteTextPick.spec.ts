// Spec: chatbot-candidate-list ("Plain-text picks are promoted on every transport",
// task 3.2). promoteTextPick is the extracted, transport-agnostic version of
// WhatsAppClient's former private promoteInteractiveOptionPick; resolveInteractiveOption's
// matching rules are unit-tested on their own (resolveInteractiveOption.spec.ts), so these
// tests only prove promoteTextPick's own contract: it reads the chat's latest outbound
// interactive payload, mutates `msg` in place on a match, and no-ops otherwise.

jest.mock('../../../../Repositories/MessageRepository', () => ({
  __esModule: true,
  default: {
    findLatestOutbound: jest.fn(),
  },
}))

import { promoteTextPick } from '../promoteTextPick'
import MessageRepository from '../../../../Repositories/MessageRepository'
import { MessageTypes } from '../../constants/MessageTypes'
import { Interactive } from '../../services/Official/Constants/Interactive'

const listOffer: Interactive = {
  type: 'list',
  action: {
    sections: [
      {
        title: 'Seccion 1',
        rows: [
          { id: 'A', title: 'El Tizón Rojo' },
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

describe('promoteTextPick', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('"2" resolves to the second row across sections', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: listOffer,
    })
    const msg = { type: MessageTypes.TEXT, body: '2', interactiveReply: null }

    await promoteTextPick('wp-client-1', '573001234567@c.us', msg)

    expect(MessageRepository.findLatestOutbound).toHaveBeenCalledWith(
      'wp-client-1',
      '573001234567@c.us'
    )
    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('B')
    expect(msg.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'B', title: 'Fila B' },
    })
  })

  it('a case- and accent-insensitive name match resolves to the matching row', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: listOffer,
    })
    const msg = { type: MessageTypes.TEXT, body: 'el tizon rojo', interactiveReply: null }

    await promoteTextPick('wp-client-1', '573001234567@c.us', msg)

    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('A')
    expect(msg.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'A', title: 'El Tizón Rojo' },
    })
  })

  it('text matching no offered row is left unchanged', async () => {
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: listOffer,
    })
    const msg = { type: MessageTypes.TEXT, body: 'Escuela', interactiveReply: null }

    await promoteTextPick('wp-client-1', '573001234567@c.us', msg)

    expect(msg.type).toBe(MessageTypes.TEXT)
    expect(msg.body).toBe('Escuela')
    expect(msg.interactiveReply).toBeNull()
  })

  it('a non-TEXT message is left unchanged and never looks up the latest outbound', async () => {
    const originalReply = {
      type: 'button_reply' as const,
      button_reply: { id: 'NATIVE', title: 'Native' },
    }
    const msg = { type: MessageTypes.INTERACTIVE, body: 'NATIVE', interactiveReply: originalReply }

    await promoteTextPick('wp-client-1', '573001234567@c.us', msg)

    expect(MessageRepository.findLatestOutbound).not.toHaveBeenCalled()
    expect(msg.type).toBe(MessageTypes.INTERACTIVE)
    expect(msg.body).toBe('NATIVE')
    expect(msg.interactiveReply).toBe(originalReply)
  })
})
