// Mock Session before any module that triggers the circular Session -> ResponseContext -> subclasses
// cycle (SessionRepository -> Session -> ResponseContext -> ... -> ChatRepository -> Session).
jest.mock('../../Models/Session', () => {
  class MockSession {
    static STATUS_COMPLETED = 'completed'
  }
  return { default: MockSession }
})

jest.mock('../../Models/WhatsappMessageRecord', () => ({
  findAll: jest.fn(),
}))

import SessionRepository from '../SessionRepository'
import WhatsappMessageRecord from '../../Models/WhatsappMessageRecord'
import { MessageTypes } from '../../Services/whatsapp/constants/MessageTypes'

function mockRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    messageId: 'm1',
    created_at: 100,
    type: MessageTypes.TEXT,
    body: 'hola',
    processed: true,
    location: null,
    interactive: null,
    interactiveReply: null,
    fromMe: false,
    ...overrides,
  }
}

describe('SessionRepository.getMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps a DB row with from_me=true onto WpMessage.fromMe: true (outbound turn survives a rehydrate)', async () => {
    ;(WhatsappMessageRecord.findAll as jest.Mock).mockResolvedValue([
      mockRecord({ messageId: 'bot-1', body: 'bot reply', fromMe: true }),
    ])

    const messages = await SessionRepository.getMessages('session-1')

    expect(messages.get('bot-1')?.fromMe).toBe(true)
  })

  it('maps a DB row with from_me=false onto WpMessage.fromMe: false (inbound turn survives a rehydrate)', async () => {
    ;(WhatsappMessageRecord.findAll as jest.Mock).mockResolvedValue([
      mockRecord({ messageId: 'user-1', body: 'user text', fromMe: false }),
    ])

    const messages = await SessionRepository.getMessages('session-1')

    expect(messages.get('user-1')?.fromMe).toBe(false)
  })

  it('preserves per-message directions across a mixed rehydrated session', async () => {
    ;(WhatsappMessageRecord.findAll as jest.Mock).mockResolvedValue([
      mockRecord({ messageId: 'user-1', body: 'first', fromMe: false }),
      mockRecord({ messageId: 'bot-1', body: 'second', fromMe: true }),
    ])

    const messages = await SessionRepository.getMessages('session-1')

    expect(messages.get('user-1')?.fromMe).toBe(false)
    expect(messages.get('bot-1')?.fromMe).toBe(true)
  })
})
