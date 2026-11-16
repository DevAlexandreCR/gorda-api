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
      findClientById: jest.fn(),
      findClientByUserId: jest.fn(),
      linkClientUserId: jest.fn(),
      relinkClientUserId: jest.fn(),
      storeOrLinkClient: jest.fn(),
      rememberUserIdForPhone: jest.fn(),
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

import {
  processOfficialMessage,
  classifyInboundType,
  handleUserIdUpdate,
  ASK_FOR_PHONE_NUMBER_FALLBACK,
} from '../MessageController'
import MessageRepository from '../../../../Repositories/MessageRepository'
import IgnoredInboundMessageAuditRepository from '../../../../Repositories/IgnoredInboundMessageAuditRepository'
import { Store } from '../../../../Services/store/Store'
import { MessageTypes } from '../../../../Services/whatsapp/constants/MessageTypes'
import { Interactive } from '../../../../Services/whatsapp/services/Official/Constants/Interactive'
import { MessagesEnum } from '../../../../Services/chatBot/MessagesEnum'
import BsuidPendingStore from '../../../../Services/whatsapp/services/Official/BsuidPendingStore'

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

// Spec: wp-bsuid-sender-resolution (support-wp-bsuid-phone-request, tasks 8-9, 10.1).
// BsuidPendingStore is a real, in-process singleton (not mocked) so these tests exercise
// its actual 10-minute/30-minute windows via fake timers; `reset()` is test-only (added for
// this task) and clears it between cases so unrelated tests never share pending/rate-limit
// state through the same key.
describe('processOfficialMessage BSUID phone resolution (support-wp-bsuid-phone-request, tasks 8-9)', () => {
  const wpClientService = {
    triggerEvent: jest.fn(),
    sendMessage: jest.fn(),
    requestContactInfo: jest.fn(),
  } as any
  const store = Store.getInstance() as any

  const askForPhoneNumberMsg = {
    id: MessagesEnum.ASK_FOR_PHONE_NUMBER,
    name: 'ASK_FOR_PHONE_NUMBER',
    description: 'ASK_FOR_PHONE_NUMBER',
    message: 'Catalog: comparte tu numero de telefono',
    enabled: true,
    interactive: null,
  }

  const greetingMsg = {
    id: MessagesEnum.GREETING,
    name: 'GREETING',
    description: 'GREETING',
    message: 'Hola, bienvenido',
    enabled: true,
    interactive: null,
  }

  // Mirrors Store.findMessageById's real fallback shape for an id that isn't in the
  // catalog at all (finding 5) — used to prove the hardcoded fallback wins over it.
  const defaultMessageFallback = {
    id: MessagesEnum.DEFAULT_MESSAGE,
    name: MessagesEnum.DEFAULT_MESSAGE,
    description: MessagesEnum.DEFAULT_MESSAGE,
    message: MessagesEnum.DEFAULT_MESSAGE,
    enabled: true,
  }

  const BSUID = 'CO.4510540692592955'

  const bsuidMessage = (overrides: Record<string, any> = {}) => ({
    id: overrides.id ?? 'wamid.bsuid',
    timestamp: Math.floor(Date.now() / 1000),
    from_user_id: BSUID,
    type: 'text',
    text: { body: 'hola' },
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T00:00:00Z'))
    BsuidPendingStore.reset()
    ;(MessageRepository.addMessage as jest.Mock).mockResolvedValue(undefined)
    store.wpClients = {}
    store.getChatById = jest.fn().mockResolvedValue({ id: 'chat-1' })
    store.findClientById = jest.fn().mockReturnValue(undefined)
    store.findClientByUserId = jest.fn().mockReturnValue(undefined)
    store.linkClientUserId = jest.fn().mockResolvedValue({ id: 'client-1' })
    store.storeOrLinkClient = jest
      .fn()
      .mockResolvedValue({ id: '573001234567', phone: '573001234567' })
    store.rememberUserIdForPhone = jest.fn()
    store.findMessageById = jest.fn((id: MessagesEnum) =>
      id === MessagesEnum.GREETING ? greetingMsg : askForPhoneNumberMsg
    )
    wpClientService.requestContactInfo = jest.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('(a) a BSUID-only text message requests the phone once and dispatches nothing', async () => {
    const message = bsuidMessage({ id: 'wamid.a' })

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(wpClientService.requestContactInfo).toHaveBeenCalledTimes(1)
    expect(wpClientService.requestContactInfo).toHaveBeenCalledWith(
      BSUID,
      askForPhoneNumberMsg.message
    )
    expect(store.getChatById).not.toHaveBeenCalled()
    expect(MessageRepository.addMessage).not.toHaveBeenCalled()
    expect(wpClientService.triggerEvent).not.toHaveBeenCalled()
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'phone_requested', wpClientId: 'wp-client-1' })
    )
  })

  it('(b) a second BSUID-only message within 10 minutes does not request again', async () => {
    await processOfficialMessage(
      bsuidMessage({ id: 'wamid.b1' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    jest.setSystemTime(new Date('2026-10-15T00:05:00Z'))

    await processOfficialMessage(
      bsuidMessage({ id: 'wamid.b2', timestamp: Math.floor(Date.now() / 1000) }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.requestContactInfo).toHaveBeenCalledTimes(1)
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).toHaveBeenCalledTimes(2)
  })

  it('(c) an attested contact share replays the pending message instead of sending GREETING', async () => {
    await processOfficialMessage(
      bsuidMessage({ id: 'wamid.c-pending' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    const contactsMessage = {
      id: 'wamid.c-contacts',
      timestamp: Math.floor(Date.now() / 1000),
      from_user_id: BSUID,
      type: 'contacts',
      contacts: [
        {
          origin: 'contact_request',
          phones: [{ wa_id: '573001234567', phone: '+573001234567' }],
          name: { formatted_name: 'Juan' },
        },
      ],
    }

    await processOfficialMessage(contactsMessage as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(store.storeOrLinkClient).toHaveBeenCalledWith({
      phone: '573001234567',
      name: 'Juan',
      userId: BSUID,
    })
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'bsuid_linked', chatId: '573001234567' })
    )
    expect(store.getChatById).toHaveBeenCalledWith('wp-client-1', '573001234567', 'Cliente')
    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(1)
    const persisted = (MessageRepository.addMessage as jest.Mock).mock.calls[0][2]
    expect(persisted.body).toBe('hola')
    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
  })

  it('(c2) an attested contact share with nothing pending sends GREETING instead', async () => {
    const contactsMessage = {
      id: 'wamid.c2-contacts',
      timestamp: Math.floor(Date.now() / 1000),
      from_user_id: BSUID,
      type: 'contacts',
      contacts: [
        {
          origin: 'contact_request',
          phones: [{ wa_id: '573001234567', phone: '+573001234567' }],
        },
      ],
    }

    await processOfficialMessage(contactsMessage as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(store.storeOrLinkClient).toHaveBeenCalledTimes(1)
    expect(MessageRepository.addMessage).not.toHaveBeenCalled()
    expect(wpClientService.sendMessage).toHaveBeenCalledWith(
      '573001234567@c.us',
      expect.objectContaining({ id: MessagesEnum.GREETING })
    )
  })

  it('(d) a forwarded contact card (origin: other) is ignored entirely', async () => {
    const contactsMessage = {
      id: 'wamid.d',
      timestamp: Math.floor(Date.now() / 1000),
      from_user_id: BSUID,
      type: 'contacts',
      contacts: [{ origin: 'other', phones: [{ wa_id: '573001234567' }] }],
    }

    await processOfficialMessage(contactsMessage as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(store.storeOrLinkClient).not.toHaveBeenCalled()
    expect(wpClientService.sendMessage).not.toHaveBeenCalled()
    expect(MessageRepository.addMessage).not.toHaveBeenCalled()
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).not.toHaveBeenCalled()
  })

  it('(e) opportunistic link fires when from and from_user_id are both present and the cached client has no wpUserId', async () => {
    store.findClientById = jest.fn().mockReturnValue({ id: '573001234567', wpUserId: undefined })

    const message = {
      id: 'wamid.e',
      timestamp: Math.floor(Date.now() / 1000),
      from: '573001234567',
      from_user_id: BSUID,
      type: 'text',
      text: { body: 'hola' },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(store.linkClientUserId).toHaveBeenCalledWith('573001234567', BSUID)
    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(1)
    expect(wpClientService.requestContactInfo).not.toHaveBeenCalled()
  })

  it('(f) resolves via value.contacts[].wa_id when from is absent and dispatches normally', async () => {
    const message = {
      id: 'wamid.f',
      timestamp: Math.floor(Date.now() / 1000),
      type: 'text',
      text: { body: 'hola' },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService, {
      contacts: [{ wa_id: '573009999999', profile: { name: 'Case B' } }],
    })

    expect(store.getChatById).toHaveBeenCalledWith('wp-client-1', '573009999999', 'Case B')
    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(1)
    expect(wpClientService.requestContactInfo).not.toHaveBeenCalled()
  })

  it('(g) resolves via a previously linked BSUID when from and contacts are both absent', async () => {
    store.findClientByUserId = jest.fn().mockReturnValue({ phone: '573005555555' })

    const message = {
      id: 'wamid.g',
      timestamp: Math.floor(Date.now() / 1000),
      from_user_id: 'CO.9999999999999',
      type: 'text',
      text: { body: 'hola' },
    }

    await processOfficialMessage(message as any, 'Cliente', 'wp-client-1', wpClientService)

    expect(store.findClientByUserId).toHaveBeenCalledWith('CO.9999999999999')
    expect(store.getChatById).toHaveBeenCalledWith('wp-client-1', '573005555555', 'Cliente')
    expect(MessageRepository.addMessage).toHaveBeenCalledTimes(1)
    expect(wpClientService.requestContactInfo).not.toHaveBeenCalled()
  })

  it('(h) a disabled catalog message sends nothing but still writes the audit row', async () => {
    store.findMessageById = jest.fn().mockReturnValue({ ...askForPhoneNumberMsg, enabled: false })

    await processOfficialMessage(
      bsuidMessage({ id: 'wamid.h' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.requestContactInfo).not.toHaveBeenCalled()
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'phone_requested' })
    )
  })

  it('(i) a missing catalog row uses the hardcoded fallback, not the fake DEFAULT_MESSAGE', async () => {
    store.findMessageById = jest.fn().mockReturnValue(defaultMessageFallback)

    await processOfficialMessage(
      bsuidMessage({ id: 'wamid.i' }) as any,
      'Cliente',
      'wp-client-1',
      wpClientService
    )

    expect(wpClientService.requestContactInfo).toHaveBeenCalledWith(
      BSUID,
      ASK_FOR_PHONE_NUMBER_FALLBACK
    )
  })
})

// Spec: wp-bsuid-sender-resolution, requirement "`user_id_update` relinks a BSUID to a new
// phone without customer interaction" (design D5, task 9.1).
describe('handleUserIdUpdate (support-wp-bsuid-phone-request, task 9.1)', () => {
  const store = Store.getInstance() as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('relinks a known previous identifier to the current one', async () => {
    store.relinkClientUserId = jest.fn().mockResolvedValue({ id: 'client-1' })

    await expect(
      handleUserIdUpdate({
        user_id_update: [{ user_id: { previous: 'CO.old', current: 'CO.new' } }],
      })
    ).resolves.toBeUndefined()

    expect(store.relinkClientUserId).toHaveBeenCalledWith('CO.old', 'CO.new')
  })

  it('never throws outward, whether relink rejects or no prior holder exists', async () => {
    store.relinkClientUserId = jest.fn().mockRejectedValueOnce(new Error('boom'))

    await expect(
      handleUserIdUpdate({
        user_id_update: [{ user_id: { previous: 'CO.unknown', current: 'CO.new' } }],
      })
    ).resolves.toBeUndefined()

    store.relinkClientUserId = jest.fn().mockResolvedValue(null)

    await expect(
      handleUserIdUpdate({
        user_id_update: [{ user_id: { previous: 'CO.unknown2', current: 'CO.new2' } }],
      })
    ).resolves.toBeUndefined()

    expect(store.relinkClientUserId).toHaveBeenCalledWith('CO.unknown2', 'CO.new2')
  })
})
