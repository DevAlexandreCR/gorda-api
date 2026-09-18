jest.mock('../../../Models/Session', () => ({
  __esModule: true,
  default: {
    STATUS_BOOKING: 'BOOKING',
    STATUS_REQUESTING_SERVICE: 'REQUESTING_SERVICE',
    STATUS_SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
    STATUS_COMPLETED: 'COMPLETED',
    STATUS_SUPPORT: 'SUPPORT',
  },
}))

const wpClientsFixture: Record<string, unknown> = {}
jest.mock('../../store/Store', () => ({
  Store: {
    getInstance: jest.fn(() => ({ wpClients: wpClientsFixture })),
  },
}))

const runAgentTurnMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../agent/AgentTurn', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...args),
}))

const runLocationAssistantTurnMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../assistant/LocationAssistantFlow', () => ({
  runLocationAssistantTurn: (...args: unknown[]) => runLocationAssistantTurnMock(...args),
}))

const sendGatedMessageMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../TurnSupport', () => ({
  sendGatedMessage: (...args: unknown[]) => sendGatedMessageMock(...args),
}))

const cancelServiceMock = jest.fn().mockResolvedValue(undefined)
const insistServiceMock = jest.fn().mockResolvedValue(undefined)
const handleInTripMessageMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../deterministic/DeterministicHandlers', () => {
  const actual = jest.requireActual('../deterministic/DeterministicHandlers')
  return {
    ...actual,
    cancelService: (...args: unknown[]) => cancelServiceMock(...args),
    insistService: (...args: unknown[]) => insistServiceMock(...args),
    handleInTripMessage: (...args: unknown[]) => handleInTripMessageMock(...args),
  }
})

import { dispatchTurn } from '../TurnDispatcher'
import { WpMessage } from '../../../Types/WpMessage'
import { MessageTypes } from '../../whatsapp/constants/MessageTypes'
import Session from '../../../Models/Session'

type WpClientFixture = { chatBot: boolean; assistant: boolean; agentInTrip: boolean }

function setWpClient(id: string, config: WpClientFixture | undefined): void {
  Object.keys(wpClientsFixture).forEach((key) => delete wpClientsFixture[key])
  if (config) {
    wpClientsFixture[id] = { id, ...config }
  }
}

function buildSession(status: string, wpClientId = 'wp-1') {
  return {
    id: 'session-1',
    status,
    wp_client_id: wpClientId,
  } as unknown as import('../../../Models/Session').default
}

function textMessage(msg = 'hola'): WpMessage {
  return {
    created_at: 1000,
    id: 'wamid-1',
    type: MessageTypes.TEXT,
    msg,
    processed: false,
    location: null,
    interactiveReply: null,
    interactive: null,
    fromMe: false,
  }
}

function locationMessage(): WpMessage {
  return {
    ...textMessage(''),
    type: MessageTypes.LOCATION,
    location: { name: 'Home', lat: 4.6, lng: -74.08 },
  }
}

function buttonMessage(id: 'CANCEL' | 'INSIST'): WpMessage {
  return {
    ...textMessage(''),
    type: MessageTypes.INTERACTIVE,
    interactiveReply: { type: 'button_reply', button_reply: { id, title: id } },
  }
}

const messageKinds: Array<[string, () => WpMessage]> = [
  ['text', () => textMessage()],
  ['location', () => locationMessage()],
  ['CANCEL button', () => buttonMessage('CANCEL')],
  ['INSIST button', () => buttonMessage('INSIST')],
]

beforeEach(() => {
  jest.clearAllMocks()
})

describe('dispatchTurn: SUPPORT/COMPLETED are always a no-op', () => {
  it.each<[string, string]>([
    ['SUPPORT', Session.STATUS_SUPPORT],
    ['COMPLETED', Session.STATUS_COMPLETED],
  ])('%s status: no flow runs regardless of line mode', async (_label, status) => {
    setWpClient('wp-1', { chatBot: true, assistant: true, agentInTrip: true })
    const session = buildSession(status)

    await dispatchTurn(session, textMessage())

    expect(runAgentTurnMock).not.toHaveBeenCalled()
    expect(runLocationAssistantTurnMock).not.toHaveBeenCalled()
    expect(cancelServiceMock).not.toHaveBeenCalled()
    expect(insistServiceMock).not.toHaveBeenCalled()
    expect(handleInTripMessageMock).not.toHaveBeenCalled()
  })
})

describe('dispatchTurn: assistant line', () => {
  it.each<['BOOKING' | 'REQUESTING_SERVICE' | 'SERVICE_IN_PROGRESS']>([
    ['BOOKING'],
    ['REQUESTING_SERVICE'],
    ['SERVICE_IN_PROGRESS'],
  ])(
    '%s status: every message kind runs the location assistant flow, never the agent',
    async (status) => {
      setWpClient('wp-1', { chatBot: false, assistant: true, agentInTrip: false })

      for (const [, build] of messageKinds) {
        jest.clearAllMocks()
        const session = buildSession(status)
        const message = build()

        await dispatchTurn(session, message)

        expect(runLocationAssistantTurnMock).toHaveBeenCalledTimes(1)
        expect(runLocationAssistantTurnMock).toHaveBeenCalledWith(session, message)
        expect(runAgentTurnMock).not.toHaveBeenCalled()
        expect(cancelServiceMock).not.toHaveBeenCalled()
        expect(insistServiceMock).not.toHaveBeenCalled()
        expect(handleInTripMessageMock).not.toHaveBeenCalled()
      }
    }
  )
})

describe('dispatchTurn: chatBot line, BOOKING', () => {
  it.each(messageKinds)('%s: runs the agent turn', async (_label, build) => {
    setWpClient('wp-1', { chatBot: true, assistant: false, agentInTrip: false })
    const session = buildSession('BOOKING')
    const message = build()

    await dispatchTurn(session, message)

    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    expect(runAgentTurnMock).toHaveBeenCalledWith(session, message)
    expect(runLocationAssistantTurnMock).not.toHaveBeenCalled()
    expect(cancelServiceMock).not.toHaveBeenCalled()
    expect(insistServiceMock).not.toHaveBeenCalled()
  })
})

describe('dispatchTurn: chatBot line, REQUESTING_SERVICE', () => {
  beforeEach(() => {
    setWpClient('wp-1', { chatBot: true, assistant: false, agentInTrip: false })
  })

  it('CANCEL button: cancels deterministically, never calls the agent', async () => {
    const session = buildSession('REQUESTING_SERVICE')
    const message = buttonMessage('CANCEL')

    await dispatchTurn(session, message)

    expect(cancelServiceMock).toHaveBeenCalledTimes(1)
    expect(cancelServiceMock).toHaveBeenCalledWith(session)
    expect(runAgentTurnMock).not.toHaveBeenCalled()
    expect(insistServiceMock).not.toHaveBeenCalled()
  })

  it('INSIST button: re-queues deterministically via sendGatedMessage, never calls the agent', async () => {
    const session = buildSession('REQUESTING_SERVICE')
    const message = buttonMessage('INSIST')

    await dispatchTurn(session, message)

    expect(insistServiceMock).toHaveBeenCalledTimes(1)
    expect(insistServiceMock.mock.calls[0][0]).toBe(session)
    const sendFn = insistServiceMock.mock.calls[0][1] as (m: unknown) => Promise<void>
    await sendFn({ enabled: true } as never)
    expect(sendGatedMessageMock).toHaveBeenCalledWith(session, { enabled: true })
    expect(runAgentTurnMock).not.toHaveBeenCalled()
    expect(cancelServiceMock).not.toHaveBeenCalled()
  })

  it('free text "cancelar" still goes to the agent, not the deterministic cancel', async () => {
    const session = buildSession('REQUESTING_SERVICE')
    const message = textMessage('quiero cancelar por favor')

    await dispatchTurn(session, message)

    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    expect(runAgentTurnMock).toHaveBeenCalledWith(session, message)
    expect(cancelServiceMock).not.toHaveBeenCalled()
    expect(insistServiceMock).not.toHaveBeenCalled()
  })

  it('plain text and location: both go to the agent', async () => {
    for (const build of [() => textMessage('ya viene?'), locationMessage]) {
      jest.clearAllMocks()
      const session = buildSession('REQUESTING_SERVICE')
      const message = build()

      await dispatchTurn(session, message)

      expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
      expect(cancelServiceMock).not.toHaveBeenCalled()
      expect(insistServiceMock).not.toHaveBeenCalled()
    }
  })
})

describe('dispatchTurn: chatBot line, SERVICE_IN_PROGRESS', () => {
  it.each(messageKinds)(
    '%s with agentInTrip off: deterministic cancel-only handler, never the agent',
    async (_label, build) => {
      setWpClient('wp-1', { chatBot: true, assistant: false, agentInTrip: false })
      const session = buildSession('SERVICE_IN_PROGRESS')
      const message = build()

      await dispatchTurn(session, message)

      expect(handleInTripMessageMock).toHaveBeenCalledTimes(1)
      expect(handleInTripMessageMock).toHaveBeenCalledWith(session, message)
      expect(runAgentTurnMock).not.toHaveBeenCalled()
    }
  )

  it.each(messageKinds)(
    '%s with agentInTrip on: runs the agent turn, never the deterministic handler',
    async (_label, build) => {
      setWpClient('wp-1', { chatBot: true, assistant: false, agentInTrip: true })
      const session = buildSession('SERVICE_IN_PROGRESS')
      const message = build()

      await dispatchTurn(session, message)

      expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
      expect(runAgentTurnMock).toHaveBeenCalledWith(session, message)
      expect(handleInTripMessageMock).not.toHaveBeenCalled()
    }
  )
})

describe('dispatchTurn: neither flag set (or unknown line) is a no-op', () => {
  it.each<[string, WpClientFixture | undefined]>([
    ['both flags off', { chatBot: false, assistant: false, agentInTrip: false }],
    ['no wpClient entry at all', undefined],
  ])('%s: no flow runs for any status/message kind', async (_label, config) => {
    setWpClient('wp-1', config)

    for (const status of ['BOOKING', 'REQUESTING_SERVICE', 'SERVICE_IN_PROGRESS']) {
      for (const [, build] of messageKinds) {
        jest.clearAllMocks()
        const session = buildSession(status)

        await dispatchTurn(session, build())

        expect(runAgentTurnMock).not.toHaveBeenCalled()
        expect(runLocationAssistantTurnMock).not.toHaveBeenCalled()
        expect(cancelServiceMock).not.toHaveBeenCalled()
        expect(insistServiceMock).not.toHaveBeenCalled()
        expect(handleInTripMessageMock).not.toHaveBeenCalled()
      }
    }
  })
})
