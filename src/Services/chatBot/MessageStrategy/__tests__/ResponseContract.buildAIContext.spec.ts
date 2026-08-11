// Mock Session before any module that triggers the circular Session -> ResponseContext -> subclasses cycle
jest.mock('../../../../Models/Session', () => {
  const SessionStatuses = {
    AGREEMENT: 'agreement',
    CREATED: 'created',
    ASKING_FOR_PLACE: 'asking_for_place',
    CHOOSING_PLACE: 'choosing_place',
    ASKING_FOR_COMMENT: 'asking_for_comment',
    REQUESTING_SERVICE: 'requesting_service',
    SERVICE_IN_PROGRESS: 'service_in_progress',
    COMPLETED: 'completed',
    ASKING_FOR_NAME: 'asking_for_name',
    SUPPORT: 'support',
  }
  class MockSession {
    static STATUS_AGREEMENT = SessionStatuses.AGREEMENT
    static STATUS_CREATED = SessionStatuses.CREATED
    static STATUS_ASKING_FOR_PLACE = SessionStatuses.ASKING_FOR_PLACE
    static STATUS_CHOOSING_PLACE = SessionStatuses.CHOOSING_PLACE
    static STATUS_ASKING_FOR_COMMENT = SessionStatuses.ASKING_FOR_COMMENT
    static STATUS_REQUESTING_SERVICE = SessionStatuses.REQUESTING_SERVICE
    static STATUS_SERVICE_IN_PROGRESS = SessionStatuses.SERVICE_IN_PROGRESS
    static STATUS_COMPLETED = SessionStatuses.COMPLETED
    static STATUS_ASKING_FOR_NAME = SessionStatuses.ASKING_FOR_NAME
    static STATUS_SUPPORT = SessionStatuses.SUPPORT
  }
  return { default: MockSession }
})

import { ResponseContract } from '../ResponseContract'
import { WpMessage } from '../../../../Types/WpMessage'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { MessageTypes } from '../../../whatsapp/constants/MessageTypes'

const mockClient: ClientInterface = {
  id: '573001234567',
  name: 'Test User',
  phone: '+573001234567',
  photoUrl: '',
}

const mockPlace: PlaceInterface = {
  id: 'place-1',
  name: 'Campanario',
  lat: 2.44,
  lng: -76.6,
  location: null,
  cityId: 'popayan',
}

function textMsg(id: string, created_at: number, fromMe: boolean, msg: string): WpMessage {
  return {
    created_at,
    id,
    type: MessageTypes.TEXT,
    msg,
    processed: true,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe,
  }
}

function locationMsg(id: string, created_at: number): WpMessage {
  return {
    created_at,
    id,
    type: MessageTypes.LOCATION,
    msg: '',
    processed: true,
    location: { name: 'Casa', lat: 2.4, lng: -76.6 },
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

function interactiveMsg(id: string, created_at: number, replyId: string): WpMessage {
  return {
    created_at,
    id,
    type: MessageTypes.INTERACTIVE,
    msg: replyId,
    processed: true,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

function outboundInteractiveMsg(id: string, created_at: number, textBody: string): WpMessage {
  return {
    created_at,
    id,
    type: MessageTypes.INTERACTIVE,
    msg: textBody,
    processed: true,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: true,
  }
}

function buildMockSession(overrides: Partial<{ place: PlaceInterface | null }> = {}) {
  return {
    id: 'session-1',
    chat_id: '573001234567@c.us',
    wp_client_id: 'wp-client-1',
    place: overrides.place ?? null,
    messages: new Map<string, WpMessage>(),
  }
}

class ConcreteResponseContract extends ResponseContract {
  messageSupported = ['text']
  async processMessage(_message: WpMessage): Promise<void> {}
}

describe('ResponseContract.buildAIContext', () => {
  it('returns history: [] and known: {name: null, place: null} for a brand-new session', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)
    const current = textMsg('current', 100, false, 'hola')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context).toEqual({ known: { name: null, place: null }, history: [] })
  })

  it('forwards known client name and session place name', () => {
    const mockSession = buildMockSession({ place: mockPlace })
    const contract = new ConcreteResponseContract(mockSession as any)
    contract['currentClient'] = mockClient
    const current = textMsg('current', 100, false, 'hola')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.known).toEqual({ name: 'Test User', place: 'Campanario' })
  })

  it('caps history at the last 10 messages, oldest-first, excluding the current message', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    // 14 prior messages plus the current one being processed
    for (let i = 1; i <= 14; i++) {
      const msg = textMsg(`msg-${i}`, i * 1000, i % 2 === 0, `text ${i}`)
      mockSession.messages.set(msg.id, msg)
    }
    const current = textMsg('current', 15000, false, 'current message')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history).toHaveLength(10)
    expect(context.history[0].text).toBe('text 5')
    expect(context.history[9].text).toBe('text 14')
    expect(context.history.some((h) => h.text === 'current message')).toBe(false)
  })

  it('labels fromMe: true as assistant and fromMe: false as user', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    const inbound = textMsg('m1', 100, false, 'user text')
    const outbound = textMsg('m2', 200, true, 'bot text')
    mockSession.messages.set(inbound.id, inbound)
    mockSession.messages.set(outbound.id, outbound)
    const current = textMsg('current', 300, false, 'current')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history).toEqual([
      { role: 'user', text: 'user text' },
      { role: 'assistant', text: 'bot text' },
    ])
  })

  it('renders inbound location as the fixed placeholder', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    const loc = locationMsg('m1', 100)
    mockSession.messages.set(loc.id, loc)
    const current = textMsg('current', 200, false, 'current')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history).toEqual([{ role: 'user', text: '[ubicación compartida]' }])
  })

  it('renders inbound interactive reply using the stored reply id', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    const interactive = interactiveMsg('m1', 100, 'option_1')
    mockSession.messages.set(interactive.id, interactive)
    const current = textMsg('current', 200, false, 'current')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history).toEqual([{ role: 'user', text: '[opción elegida: option_1]' }])
  })

  it('renders an outbound interactive/list turn as its stored text body, not the reply-id placeholder', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    const outboundInteractive = outboundInteractiveMsg('m1', 100, '¿En qué barrio te recogemos?')
    mockSession.messages.set(outboundInteractive.id, outboundInteractive)
    const current = textMsg('current', 200, false, 'current')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history).toEqual([{ role: 'assistant', text: '¿En qué barrio te recogemos?' }])
  })

  it('sorts by created_at rather than Map insertion order', () => {
    const mockSession = buildMockSession()
    const contract = new ConcreteResponseContract(mockSession as any)

    // Inserted out of chronological order
    const second = textMsg('m2', 200, false, 'second')
    const first = textMsg('m1', 100, false, 'first')
    mockSession.messages.set(second.id, second)
    mockSession.messages.set(first.id, first)
    const current = textMsg('current', 300, false, 'current')
    mockSession.messages.set(current.id, current)

    const context = contract.buildAIContext(current)

    expect(context.history.map((h) => h.text)).toEqual(['first', 'second'])
  })
})
