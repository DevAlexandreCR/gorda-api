import fs from 'fs'
import path from 'path'

jest.mock('../../../../Models/Session', () => ({
  __esModule: true,
  default: { STATUS_COMPLETED: 'completed' },
}))

const cancelMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../../../../Models/Service', () => ({
  __esModule: true,
  default: class MockService {
    id?: string
    created_at?: number
    status?: string
    cancel() {
      return cancelMock()
    }
  },
}))

jest.mock('../../../../Repositories/ServiceRepository', () => ({
  findServiceById: jest.fn(),
}))

jest.mock('../../../firebase/Database', () => ({
  dbServices: jest.fn(),
}))

const mockCancelTimeout = jest.fn()
jest.mock('../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      getWhatsAppClient: jest.fn().mockReturnValue({ cancelTimeout: mockCancelTimeout }),
    }),
  },
}))

// Messages.getSingleMessage normally resolves through Store.findMessageById;
// stubbed here so these tests assert only on which catalog id was requested,
// not on Messages/Store's own resolution logic.
jest.mock('../../Messages', () => ({
  getSingleMessage: jest.fn((id: string) => ({
    id,
    name: id,
    description: '',
    message: id,
    enabled: true,
    interactive: null,
  })),
}))

import ServiceRepository from '../../../../Repositories/ServiceRepository'
import Database from '../../../firebase/Database'
import { WpMessage } from '../../../../Types/WpMessage'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'
import { MessagesEnum } from '../../MessagesEnum'
import {
  askForCancelWhileFindDriver,
  cancelService,
  handleInTripMessage,
  handleRequestingServiceMessage,
  insistService,
  isCancelMessage,
  isInsistMessage,
} from '../DeterministicHandlers'

function buildSession(serviceId: string | null = 'svc-1') {
  return {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    wp_client_id: 'wp-client-1',
    service_id: serviceId,
    setStatus: jest.fn().mockResolvedValue(undefined),
  }
}

function textMessage(msg: string): WpMessage {
  return {
    created_at: 0,
    id: 'msg-1',
    type: MessageTypes.TEXT,
    msg,
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

function buttonMessage(id: string): WpMessage {
  return {
    created_at: 0,
    id: 'msg-1',
    type: MessageTypes.INTERACTIVE,
    msg: id,
    processed: false,
    location: null,
    interactiveReply: { type: 'button_reply', button_reply: { id, title: id } },
    interactive: null,
    fromMe: false,
  }
}

// Design D10 / spec: wp-inbound-message-normalization ("List replies are honored
// wherever button replies are"): a native list_reply, as Official sends it.
function listMessage(id: string): WpMessage {
  return {
    created_at: 0,
    id: 'msg-1',
    type: MessageTypes.INTERACTIVE,
    msg: id,
    processed: false,
    location: null,
    interactiveReply: { type: 'list_reply', list_reply: { id, title: id } },
    interactive: null,
    fromMe: false,
  }
}

describe('DeterministicHandlers', () => {
  const mockSendMessage = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    ;(ServiceRepository.findServiceById as jest.Mock).mockResolvedValue({
      id: 'svc-1',
      status: 'pending',
    })
    ;(Database.dbServices as jest.Mock).mockReturnValue({
      child: jest.fn().mockReturnValue({ update: jest.fn().mockResolvedValue(undefined) }),
    })
  })

  it('never imports the agent module or an OpenAI client (no model calls on these paths)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../DeterministicHandlers.ts'), 'utf8')
    expect(source).not.toMatch(/OpenAIResponsesClient/)
    expect(source).not.toMatch(/chatBot\/agent/)
    expect(source).not.toMatch(/from ['"]openai['"]/)
  })

  describe('isCancelMessage / isInsistMessage', () => {
    it('detects the "cancelar" keyword case-insensitively', () => {
      expect(isCancelMessage(textMessage('Quiero CANCELAR por favor'))).toBe(true)
      expect(isCancelMessage(textMessage('todo bien'))).toBe(false)
    })

    it('detects the CANCEL button reply', () => {
      expect(isCancelMessage(buttonMessage('CANCEL'))).toBe(true)
      expect(isCancelMessage(buttonMessage('cancel'))).toBe(true)
    })

    // Spec scenario "Official list selection cancels a service": a CANCEL list_reply
    // (e.g. from an Official native list) must trigger the deterministic shortcut the
    // same way a CANCEL button_reply does (design D10).
    it('detects the CANCEL list reply', () => {
      expect(isCancelMessage(listMessage('CANCEL'))).toBe(true)
      expect(isCancelMessage(listMessage('cancel'))).toBe(true)
    })

    it('detects the INSIST button reply only', () => {
      expect(isInsistMessage(buttonMessage('INSIST'))).toBe(true)
      expect(isInsistMessage(buttonMessage('CANCEL'))).toBe(false)
      expect(isInsistMessage(textMessage('insist'))).toBe(false)
    })
  })

  describe('cancelService', () => {
    it('cancels the active service and completes the session', async () => {
      const session = buildSession('svc-1')

      await cancelService(session as any)

      expect(ServiceRepository.findServiceById).toHaveBeenCalledWith('svc-1')
      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(session.setStatus).toHaveBeenCalledWith('completed')
    })

    it('does nothing when the session has no active service', async () => {
      const session = buildSession(null)

      await cancelService(session as any)

      expect(ServiceRepository.findServiceById).not.toHaveBeenCalled()
      expect(cancelMock).not.toHaveBeenCalled()
      expect(session.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('insistService', () => {
    it('bumps created_at, clears the pending timeout and sends INSISTING', async () => {
      const session = buildSession('svc-1')

      await insistService(session as any, mockSendMessage)

      expect(mockCancelTimeout).toHaveBeenCalledWith('svc-1', session.chat_id)
      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      const sentMessage = mockSendMessage.mock.calls[0][0]
      expect(sentMessage.id).toBe(MessagesEnum.INSISTING)
    })

    it('still sends INSISTING when there is no active service', async () => {
      const session = buildSession(null)

      await insistService(session as any, mockSendMessage)

      expect(mockCancelTimeout).not.toHaveBeenCalled()
      expect(mockSendMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('askForCancelWhileFindDriver', () => {
    it('sends the ASK_FOR_CANCEL_WHILE_FIND_DRIVER catalog message', async () => {
      await askForCancelWhileFindDriver(mockSendMessage)

      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      expect(mockSendMessage.mock.calls[0][0].id).toBe(
        MessagesEnum.ASK_FOR_CANCEL_WHILE_FIND_DRIVER
      )
    })
  })

  describe('handleRequestingServiceMessage (assistant line only)', () => {
    it('cancels on the "cancelar" keyword', async () => {
      const session = buildSession('svc-1')

      await handleRequestingServiceMessage(session as any, textMessage('cancelar'), mockSendMessage)

      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(session.setStatus).toHaveBeenCalledWith('completed')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('cancels on the CANCEL button', async () => {
      const session = buildSession('svc-1')

      await handleRequestingServiceMessage(session as any, buttonMessage('CANCEL'), mockSendMessage)

      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(session.setStatus).toHaveBeenCalledWith('completed')
    })

    it('restarts and sends INSISTING on the INSIST button', async () => {
      const session = buildSession('svc-1')

      await handleRequestingServiceMessage(session as any, buttonMessage('INSIST'), mockSendMessage)

      expect(mockCancelTimeout).toHaveBeenCalledWith('svc-1', session.chat_id)
      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      expect(mockSendMessage.mock.calls[0][0].id).toBe(MessagesEnum.INSISTING)
      expect(session.setStatus).not.toHaveBeenCalled()
    })

    it('sends ASK_FOR_CANCEL_WHILE_FIND_DRIVER for any other text', async () => {
      const session = buildSession('svc-1')

      await handleRequestingServiceMessage(
        session as any,
        textMessage('¿ya viene el conductor?'),
        mockSendMessage
      )

      expect(cancelMock).not.toHaveBeenCalled()
      expect(mockSendMessage).toHaveBeenCalledTimes(1)
      expect(mockSendMessage.mock.calls[0][0].id).toBe(
        MessagesEnum.ASK_FOR_CANCEL_WHILE_FIND_DRIVER
      )
    })
  })

  describe('handleInTripMessage (in-trip cancel-only)', () => {
    it('cancels on "cancelar"', async () => {
      const session = buildSession('svc-1')

      await handleInTripMessage(session as any, textMessage('cancelar'))

      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(session.setStatus).toHaveBeenCalledWith('completed')
    })

    it('cancels on the CANCEL button', async () => {
      const session = buildSession('svc-1')

      await handleInTripMessage(session as any, buttonMessage('CANCEL'))

      expect(cancelMock).toHaveBeenCalledTimes(1)
    })

    it('produces no reply and no side effect for any other message', async () => {
      const session = buildSession('svc-1')

      await handleInTripMessage(session as any, textMessage('ya viene?'))

      expect(cancelMock).not.toHaveBeenCalled()
      expect(session.setStatus).not.toHaveBeenCalled()
      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })
})
