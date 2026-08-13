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
  findOrCreate: jest.fn(),
  update: jest.fn(),
}))

jest.mock('../../Models/ChatSessionRecord', () => ({
  findByPk: jest.fn(),
}))

import { Op } from 'sequelize'
import SessionRepository from '../SessionRepository'
import WhatsappMessageRecord from '../../Models/WhatsappMessageRecord'
import ChatSessionRecord from '../../Models/ChatSessionRecord'
import { MessageTypes } from '../../Services/whatsapp/constants/MessageTypes'
import { WpMessage } from '../../Types/WpMessage'

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
    return jest.fn((query: { where: Record<string, unknown>; order: Array<[string, string]> }) => {
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
    })
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

function mockSessionRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-A',
    wpClientId: 'wp-1',
    chatId: 'chat-1',
    ...overrides,
  }
}

function mockMessageRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    messageId: 'wamid-1',
    wpClientId: 'wp-1',
    chatId: 'chat-1',
    chatSessionId: 'session-A',
    created_at: 100,
    type: MessageTypes.TEXT,
    body: 'hola',
    fromMe: false,
    processed: false,
    location: null,
    interactive: null,
    interactiveReply: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function mockWpMessage(id: string, overrides: Partial<WpMessage> = {}): WpMessage {
  return {
    id,
    created_at: 200,
    type: MessageTypes.TEXT,
    msg: 'hello',
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
    ...overrides,
  }
}

describe('SessionRepository.addMsg', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(ChatSessionRecord.findByPk as jest.Mock).mockResolvedValue(
      mockSessionRecord({ id: 'session-A', wpClientId: 'wp-1', chatId: 'chat-1' })
    )
  })

  it('persists a brand-new wamid under the calling session and returns created: true', async () => {
    const created = mockMessageRecord({ messageId: 'wamid-1', chatSessionId: 'session-A' })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([created, true])

    const result = await SessionRepository.addMsg('session-A', mockWpMessage('wamid-1'))

    expect(result).toEqual({ created: true, id: 'wamid-1' })
    expect(created.save).not.toHaveBeenCalled()
  })

  it('adopts a pre-persisted null-session row via the conditional update and returns created: true', async () => {
    const existing = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: null,
      body: 'old body',
      processed: false,
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([existing, false])
    ;(WhatsappMessageRecord.update as jest.Mock).mockResolvedValue([1])

    const result = await SessionRepository.addMsg(
      'session-A',
      mockWpMessage('wamid-1', { msg: 'new body', processed: true })
    )

    expect(result).toEqual({ created: true, id: 'wamid-1' })
    expect(WhatsappMessageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ chatSessionId: 'session-A' }),
      expect.objectContaining({
        where: expect.objectContaining({ messageId: 'wamid-1', chatSessionId: null }),
      })
    )
    expect(existing.save).not.toHaveBeenCalled()
  })

  it('falls back to cross-session dedup, with a warning, when the conditional adoption of a null-session row loses the race to another session', async () => {
    const existing = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: null,
    })
    const adoptedByOther = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: 'session-B',
      body: 'winner body',
      processed: true,
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([existing, false])
    ;(WhatsappMessageRecord.update as jest.Mock).mockResolvedValue([0])
    ;(WhatsappMessageRecord.findOne as jest.Mock).mockResolvedValue(adoptedByOther)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await SessionRepository.addMsg(
      'session-A',
      mockWpMessage('wamid-1', { msg: 'attempted overwrite' })
    )

    expect(result).toEqual({ created: false, id: 'wamid-1' })
    expect(existing.save).not.toHaveBeenCalled()
    expect(adoptedByOther.save).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAddMsgCrossSessionDuplicate]',
      expect.stringContaining('"owningSessionId":"session-B"')
    )

    warnSpy.mockRestore()
  })

  it('refreshes mutable fields and returns created: false for a same-session duplicate', async () => {
    const existing = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: 'session-A',
      body: 'old body',
      processed: false,
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([existing, false])

    const result = await SessionRepository.addMsg(
      'session-A',
      mockWpMessage('wamid-1', { msg: 'new body', processed: true })
    )

    expect(result).toEqual({ created: false, id: 'wamid-1' })
    expect(existing.body).toBe('new body')
    expect(existing.processed).toBe(true)
    expect(existing.save).toHaveBeenCalledTimes(1)
  })

  it('does not modify any field, logs a structured warning, and returns created: false for a cross-session duplicate', async () => {
    const existing = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: 'session-A',
      body: 'original body',
      processed: true,
      created_at: 100,
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([existing, false])
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;(ChatSessionRecord.findByPk as jest.Mock).mockResolvedValue(
      mockSessionRecord({ id: 'session-B', wpClientId: 'wp-1', chatId: 'chat-1' })
    )

    const result = await SessionRepository.addMsg(
      'session-B',
      mockWpMessage('wamid-1', { msg: 'attempted overwrite', processed: false, created_at: 999 })
    )

    expect(result).toEqual({ created: false, id: 'wamid-1' })
    expect(existing.chatSessionId).toBe('session-A')
    expect(existing.body).toBe('original body')
    expect(existing.processed).toBe(true)
    expect(existing.created_at).toBe(100)
    expect(existing.save).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAddMsgCrossSessionDuplicate]',
      expect.stringContaining('"owningSessionId":"session-A"')
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[SessionAddMsgCrossSessionDuplicate]',
      expect.stringContaining('"callingSessionId":"session-B"')
    )

    warnSpy.mockRestore()
  })

  it('never downgrades an already-processed row back to unprocessed on the same-session path', async () => {
    const existing = mockMessageRecord({
      messageId: 'wamid-1',
      chatSessionId: 'session-A',
      processed: true,
    })
    ;(WhatsappMessageRecord.findOrCreate as jest.Mock).mockResolvedValue([existing, false])

    const result = await SessionRepository.addMsg(
      'session-A',
      mockWpMessage('wamid-1', { processed: false }),
      false
    )

    expect(existing.processed).toBe(true)
    expect(result).toEqual({ created: false, id: 'wamid-1' })
  })
})

describe('SessionRepository.setProcessedMsgs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Minimal stand-in for Sequelize's bulk UPDATE ... WHERE: mutates only the
  // records matching the `where` clause the repository passes to `update`,
  // including Op.in membership on messageId — so the assertions prove the
  // query scoping itself (chat_session_id ownership) rather than a canned result.
  function simulateUpdate(records: Array<Record<string, unknown>>) {
    return jest.fn(
      (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
        records.forEach((record) => {
          const matches = Object.entries(options.where).every(([key, value]) => {
            if (value && typeof value === 'object' && Op.in in (value as object)) {
              const inList = (value as Record<symbol, unknown[]>)[Op.in]
              return inList.includes(record[key])
            }
            return record[key] === value
          })
          if (matches) {
            Object.assign(record, values)
          }
        })
        return Promise.resolve([records.length])
      }
    )
  }

  it("scopes the bulk update to the calling session, leaving another session's row untouched", async () => {
    ;(ChatSessionRecord.findByPk as jest.Mock).mockResolvedValue(
      mockSessionRecord({ id: 'session-B', wpClientId: 'wp-1', chatId: 'chat-1' })
    )
    const rows = [
      { messageId: 'wamid-1', wpClientId: 'wp-1', chatSessionId: 'session-A', processed: false },
      { messageId: 'wamid-2', wpClientId: 'wp-1', chatSessionId: 'session-B', processed: false },
    ]
    ;(WhatsappMessageRecord.update as jest.Mock).mockImplementation(simulateUpdate(rows))

    await SessionRepository.setProcessedMsgs('session-B', [
      mockWpMessage('wamid-1'),
      mockWpMessage('wamid-2'),
    ])

    expect(rows[0].chatSessionId).toBe('session-A')
    expect(rows[0].processed).toBe(false)
    expect(rows[1].processed).toBe(true)
    expect(WhatsappMessageRecord.update).toHaveBeenCalledWith(
      { processed: true },
      expect.objectContaining({
        where: expect.objectContaining({ chatSessionId: 'session-B' }),
      })
    )
  })
})
