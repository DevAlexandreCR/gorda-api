// Spec: wp-inbound-message-normalization ("List replies are honored wherever button
// replies are", task 5.1). processOfficialMessage is the Official webhook's own
// normalization + persistence step (design D10 names it "MessageController (Official
// webhook body)"); it is exported solely so this fix can be exercised directly instead
// of through the full webhook HTTP route and its fire-and-forget dispatch.

jest.mock('../../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      wpClients: {},
      getChatById: jest.fn().mockResolvedValue({ id: 'chat-1' }),
    }),
  },
}))

jest.mock('../../../../Repositories/MessageRepository', () => ({
  __esModule: true,
  default: {
    addMessage: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../../../../Repositories/IgnoredInboundMessageAuditRepository', () => ({
  __esModule: true,
  default: {
    recordIgnoredEvent: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('../../../../Services/whatsapp/monitoring/InboundMessageMetrics', () => ({
  __esModule: true,
  default: {
    increment: jest.fn(),
  },
}))

jest.mock('../../../../Services/whatsapp/policies/InboundMessageDedupCache', () => ({
  __esModule: true,
  default: {
    evaluate: jest.fn().mockResolvedValue({ action: 'process', reason: 'processable' }),
    recordProcessed: jest.fn().mockResolvedValue(undefined),
  },
}))

import { processOfficialMessage } from '../MessageController'
import MessageRepository from '../../../../Repositories/MessageRepository'

describe('processOfficialMessage interactive list_reply normalization (design D10, task 5.1)', () => {
  const wpClientService = { triggerEvent: jest.fn() } as any

  beforeEach(() => {
    jest.clearAllMocks()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
  })

  it('persists a native list_reply with the selected row id as body (spec scenario: Persistence keeps the selection)', async () => {
    const message = {
      id: 'wamid.list-1',
      timestamp: Math.floor(Date.now() / 1000),
      from: '573001234567',
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'CANCEL', title: 'Cancelar' },
      },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(1)
    const persisted = (MessageRepository.addMessage as jest.Mock).mock.calls[0][2]
    expect(persisted.body).toBe('CANCEL')
    expect(persisted.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'CANCEL', title: 'Cancelar' },
    })
  })

  it('still prefers button_reply over list_reply when both are present', async () => {
    const message = {
      id: 'wamid.button-1',
      timestamp: Math.floor(Date.now() / 1000),
      from: '573001234567',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'INSIST', title: 'Insistir' },
        list_reply: { id: 'OTHER', title: 'Otro' },
      },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    const persisted = (MessageRepository.addMessage as jest.Mock).mock.calls[0][2]
    expect(persisted.body).toBe('INSIST')
  })
})
