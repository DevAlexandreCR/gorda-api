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
      findMessageById: jest.fn(),
    }),
  },
}))

jest.mock('../../../../Repositories/MessageRepository', () => ({
  __esModule: true,
  default: {
    addMessage: jest.fn().mockResolvedValue(undefined),
    findLatestOutbound: jest.fn().mockResolvedValue(null),
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

import { processOfficialMessage, classifyInboundType } from '../MessageController'
import MessageRepository from '../../../../Repositories/MessageRepository'
import { Store } from '../../../../Services/store/Store'
import { MessageTypes } from '../../../../Services/whatsapp/constants/MessageTypes'
import { Interactive } from '../../../../Services/whatsapp/services/Official/Constants/Interactive'

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

describe('processOfficialMessage inbound type policy (design D1, tasks 1.1/1.2)', () => {
  const wpClientService = { triggerEvent: jest.fn(), sendMessage: jest.fn() } as any
  const store = Store.getInstance() as any

  const baseMessage = (overrides: Record<string, any>) => ({
    id: overrides.id ?? 'wamid.base',
    timestamp: Math.floor(Date.now() / 1000),
    from: '573001234567',
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    store.wpClients = { 'wp-client-1': { chatBot: true } }
    store.getChatById = jest.fn().mockResolvedValue({ id: 'chat-1' })
    store.findMessageById = jest.fn().mockReturnValue({
      id: 'MESSAGE_TYPE_NOT_SUPPORTED',
      name: 'MESSAGE_TYPE_NOT_SUPPORTED',
      description: 'MESSAGE_TYPE_NOT_SUPPORTED',
      message: 'No puedo leer ese tipo de mensaje.',
      enabled: true,
      interactive: null,
    })
  })

  it('sends no reply for two unsupported messages but persists both (spec: unsupported events are ignored silently)', async () => {
    await processOfficialMessage(
      baseMessage({ id: 'wamid.1', type: 'unsupported' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )
    await processOfficialMessage(
      baseMessage({ id: 'wamid.2', type: 'unsupported' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(2)
  })

  it('sends the catalog reply once for an audio message and still triggers MESSAGE_RECEIVED (spec: media messages get one reply)', async () => {
    await processOfficialMessage(
      baseMessage({ id: 'wamid.audio', type: 'audio' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.sendMessage).toHaveBeenCalledTimes(1)
    expect(wpClientService.sendMessage).toHaveBeenCalledWith(
      '573001234567@c.us',
      expect.objectContaining({ id: 'MESSAGE_TYPE_NOT_SUPPORTED' })
    )
    expect(wpClientService.triggerEvent).toHaveBeenCalledTimes(1)
  })

  it('does not reply when the catalog message is disabled', async () => {
    store.findMessageById = jest.fn().mockReturnValue({
      id: 'MESSAGE_TYPE_NOT_SUPPORTED',
      enabled: false,
    })

    await processOfficialMessage(
      baseMessage({ id: 'wamid.audio-disabled', type: 'audio' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
  })

  it('treats an image caption as text: body is the caption, no catalog reply (spec: image with caption)', async () => {
    await processOfficialMessage(
      baseMessage({ id: 'wamid.img', type: 'image', image: { caption: 'casa verde' } }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
    const persisted = (MessageRepository.addMessage as jest.Mock).mock.calls[0][2]
    expect(persisted.body).toBe('casa verde')
    expect(persisted.type).toBe(MessageTypes.TEXT)
  })

  it('keeps a static location pin processable with no reply (spec: static pins remain processable)', async () => {
    await processOfficialMessage(
      baseMessage({
        id: 'wamid.loc',
        type: 'location',
        location: { latitude: 4.1, longitude: -75.2 },
      }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
  })
})

describe('processOfficialMessage plain-text pick promotion (spec: chatbot-candidate-list, task 3.2)', () => {
  const wpClientService = { triggerEvent: jest.fn(), sendMessage: jest.fn() } as any
  const store = Store.getInstance() as any

  const fourRowList: Interactive = {
    type: 'list',
    action: {
      sections: [
        {
          title: 'Opciones',
          rows: [
            { id: 'PLACE_A', title: 'San Bernardino' },
            { id: 'PLACE_B', title: 'Sub Estacion San Bernardino' },
            { id: 'PLACE_C', title: 'El Tizón Rojo' },
            { id: 'NONE', title: 'Ninguno de estos' },
          ],
        },
      ],
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    ;(MessageRepository.findLatestOutbound as jest.Mock).mockResolvedValue({
      interactive: fourRowList,
    })
    store.wpClients = { 'wp-client-1': { chatBot: true } }
    store.getChatById = jest.fn().mockResolvedValue({ id: 'chat-1' })
  })

  it('persists a plain-text "2" as the second row\'s INTERACTIVE reply (scenario: Customer types a number on Official)', async () => {
    const message = {
      id: 'wamid.text-pick-1',
      timestamp: Math.floor(Date.now() / 1000),
      from: '573001234567',
      type: 'text',
      text: { body: '2' },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(MessageRepository.findLatestOutbound).toHaveBeenCalledWith('wp-client-1', '573001234567')
    const persisted = (MessageRepository.addMessage as jest.Mock).mock.calls[0][2]
    expect(persisted.type).toBe(MessageTypes.INTERACTIVE)
    expect(persisted.body).toBe('PLACE_B')
    expect(persisted.interactiveReply).toEqual({
      type: 'list_reply',
      list_reply: { id: 'PLACE_B', title: 'Sub Estacion San Bernardino' },
    })
  })
})

describe('classifyInboundType (pure function, task 1.2e)', () => {
  const processableTypes = [MessageTypes.TEXT, MessageTypes.LOCATION, MessageTypes.INTERACTIVE]
  const mediaTypes = [
    MessageTypes.AUDIO,
    MessageTypes.VOICE,
    MessageTypes.IMAGE,
    MessageTypes.VIDEO,
    MessageTypes.DOCUMENT,
  ]

  it.each(Object.values(MessageTypes))('classifies %s correctly with no text present', (type) => {
    const expected = processableTypes.includes(type as MessageTypes)
      ? 'processable'
      : mediaTypes.includes(type as MessageTypes)
        ? 'media'
        : 'ignore'

    expect(classifyInboundType(type, false)).toBe(expected)
  })

  it('classifies a Cloud API "unsupported" type as ignore', () => {
    expect(classifyInboundType('unsupported', false)).toBe('ignore')
  })

  it('treats any type as processable once text is present', () => {
    expect(classifyInboundType(MessageTypes.AUDIO, true)).toBe('processable')
    expect(classifyInboundType('unsupported', true)).toBe('processable')
  })
})
