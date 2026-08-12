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
  findOne: jest.fn(),
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

describe('SessionRepository.getNewestUnprocessedMessageId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Minimal stand-in for Sequelize's WHERE/ORDER BY: applies the exact `where`
  // and `order` the repository passes to findOne, so the assertions below
  // prove the query itself is correct (ordered by created_at DESC, id DESC)
  // rather than hard-coding the expected winner.
  function simulateFindOne(records: Array<Record<string, unknown>>) {
    return jest.fn(
      (query: { where: Record<string, unknown>; order: Array<[string, string]> }) => {
        const filtered = records.filter((record) =>
          Object.entries(query.where).every(([key, value]) => record[key] === value)
        )
        const sorted = [...filtered].sort((a, b) => {
          for (const [field, dir] of query.order) {
            const diff = Number(a[field]) - Number(b[field])
            if (diff !== 0) {
              return dir === 'DESC' ? -diff : diff
            }
          }
          return 0
        })
        return Promise.resolve(sorted[0] ?? null)
      }
    )
  }

  it('breaks a same-second tie between unprocessed messages using the auto-increment id, returning the wamid (not the PK)', async () => {
    const records = [
      {
        id: 1,
        messageId: 'wamid-1',
        created_at: 1000,
        processed: false,
        fromMe: false,
        chatSessionId: 'session-1',
      },
      {
        id: 3,
        messageId: 'wamid-3',
        created_at: 1000,
        processed: false,
        fromMe: false,
        chatSessionId: 'session-1',
      },
      {
        id: 2,
        messageId: 'wamid-2',
        created_at: 1000,
        processed: false,
        fromMe: false,
        chatSessionId: 'session-1',
      },
    ]
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockImplementation(simulateFindOne(records))

    const result = await SessionRepository.getNewestUnprocessedMessageId('session-1')

    expect(result).toBe('wamid-3')
  })

  it('returns null when the session has no unprocessed messages', async () => {
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(null)

    const result = await SessionRepository.getNewestUnprocessedMessageId('session-1')

    expect(result).toBeNull()
  })

  it('scopes the query to the session, unprocessed, non-fromMe messages, ordered by (created_at DESC, id DESC)', async () => {
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(null)

    await SessionRepository.getNewestUnprocessedMessageId('session-1')

    expect(WhatsappMessageRecord.findOne).toHaveBeenCalledWith({
      where: { chatSessionId: 'session-1', processed: false, fromMe: false },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    })
  })
})
