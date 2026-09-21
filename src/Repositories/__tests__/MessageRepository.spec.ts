jest.mock('../../Models/WhatsappMessageRecord', () => ({
  findAll: jest.fn(),
  findOne: jest.fn(),
  findOrCreate: jest.fn(),
  update: jest.fn(),
}))

jest.mock('../ChatRepository', () => ({
  __esModule: true,
  default: { updateChatWithMessage: jest.fn().mockResolvedValue(null) },
}))

jest.mock('../../Services/whatsapp/ChatRealtimeGateway', () => ({
  __esModule: true,
  default: { emitMessageCreated: jest.fn() },
}))

import MessageRepository from '../MessageRepository'
import WhatsappMessageRecord from '../../Models/WhatsappMessageRecord'
import { MessageTypes } from '../../Services/whatsapp/constants/MessageTypes'

function mockRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    messageId: 'm1',
    created_at: 100,
    type: MessageTypes.TEXT,
    body: 'hola',
    fromMe: true,
    location: null,
    interactive: null,
    interactiveReply: null,
    ...overrides,
  }
}

describe('MessageRepository.findLatestOutbound', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when the chat has no outbound message', async () => {
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(null)

    const result = await MessageRepository.findLatestOutbound('wp-1', 'chat-1')

    expect(result).toBeNull()
  })

  it('maps the newest outbound row, carrying its interactive payload', async () => {
    const interactive = {
      type: 'button',
      body: { text: 'Choose one' },
      buttons: [{ id: 'yes', title: 'Yes' }],
    }
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(
      mockRecord({ messageId: 'bot-1', body: 'Choose one', interactive })
    )

    const result = await MessageRepository.findLatestOutbound('wp-1', 'chat-1')

    expect(result?.id).toBe('bot-1')
    expect(result?.fromMe).toBe(true)
    expect(result?.interactive).toEqual(interactive)
  })

  it('scopes the query to wpClientId, the normalized chatId, and fromMe, ordered by (created_at DESC, id DESC)', async () => {
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(null)

    await MessageRepository.findLatestOutbound('wp-1', '573001234567@c.us')

    expect(WhatsappMessageRecord.findOne).toHaveBeenCalledWith({
      where: { wpClientId: 'wp-1', chatId: '573001234567', fromMe: true },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    })
  })
})
