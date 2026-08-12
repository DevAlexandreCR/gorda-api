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

jest.mock('../../../../Repositories/ServiceRepository', () => ({
  create: jest.fn(),
}))

jest.mock('../../../../Services/store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      findCountryByCity: jest.fn().mockReturnValue('colombia'),
    }),
  },
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

jest.mock('../../../../Container/Container', () => ({
  __esModule: true,
  default: {
    getPlaceRepository: jest.fn(),
    getServiceHistoryRepository: jest.fn(),
  },
}))

import { ResponseContract } from '../ResponseContract'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { WpMessage } from '../../../../Types/WpMessage'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'
import * as Sentry from '@sentry/node'
import { DiscardedTurnError } from '../../turns/DiscardedTurnError'
import { ChatBotMessage } from '../../../../Types/ChatBotMessage'
import { SessionStatuses } from '../../../../Types/SessionStatuses'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockedContainer = require('../../../../Container/Container').default
const mockCountFn = jest.fn()

const mockPlace: PlaceInterface = {
  id: 'place-1',
  name: 'Test Place',
  lat: 2.44,
  lng: -76.6,
  location: null,
  cityId: 'popayan',
}

const mockClient: ClientInterface = {
  id: '573001234567',
  name: 'Test User',
  phone: '+573001234567',
  photoUrl: '',
}

function buildMockSession(chatId: string) {
  return {
    chat_id: chatId,
    wp_client_id: 'wp-client-1',
    service_id: null as string | null,
    setService: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    setPlace: jest.fn().mockResolvedValue(undefined),
    setPlaceOptions: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
  }
}

class ConcreteResponseContract extends ResponseContract {
  messageSupported = ['text']
  async processMessage(_message: WpMessage): Promise<void> {}
}

function buildOutboundMessage(overrides: Partial<ChatBotMessage> = {}): ChatBotMessage {
  return {
    id: 'msg-1',
    name: 'Test Message',
    description: '',
    message: 'hola',
    enabled: true,
    interactive: null,
    ...overrides,
  }
}

// design D3: sendMessage() is the single outbound funnel, and its turn-gate
// check (session.assertTurnStillValid()) MUST run before the
// retryPromise(...).catch(Sentry.captureException + exit(1)) block, throwing
// (not silently resolving) so any .then()-chained mutation a strategy makes
// after a send never executes for a stale turn.
describe('ResponseContract.sendMessage turn gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects with DiscardedTurnError and never sends when the turn is stale', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest.fn().mockRejectedValue(new DiscardedTurnError('superseded'))
    const contract = new ConcreteResponseContract(mockSession as any)

    await expect(contract.sendMessage(buildOutboundMessage())).rejects.toBeInstanceOf(
      DiscardedTurnError
    )

    expect(mockSession.sendMessage).not.toHaveBeenCalled()
  })

  it('never reaches the retryPromise/catch block: process.exit and Sentry.captureException are NOT invoked on a benign discard', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest.fn().mockRejectedValue(new DiscardedTurnError('superseded'))
    const contract = new ConcreteResponseContract(mockSession as any)

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const sentrySpy = jest.spyOn(Sentry, 'captureException')

    await expect(contract.sendMessage(buildOutboundMessage())).rejects.toBeInstanceOf(
      DiscardedTurnError
    )

    // A regression here (assertTurnStillValid moved past the retryPromise/catch,
    // or the check turned into a no-op resolve) would crash the process via
    // exit(1) on every benign discard — see design.md D3's placement hazard.
    expect(exitSpy).not.toHaveBeenCalled()
    expect(sentrySpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
  })

  it('does not run .then()-chained session mutations after a blocked send (the exact hazard design D3 exists to prevent)', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest.fn().mockRejectedValue(new DiscardedTurnError('superseded'))
    const contract = new ConcreteResponseContract(mockSession as any)

    // Mirrors the exact chained-mutation pattern real strategies use after a
    // send (e.g. AskingForPlace/runPlaceSearchFlow:
    // sendMessage(...).then(async () => { setStatus(); setPlace(); setPlaceOptions() })).
    // If sendMessage silently resolved instead of throwing on a stale turn,
    // this .then() callback would run and leak a stale mutation.
    const chain = contract.sendMessage(buildOutboundMessage()).then(async () => {
      await mockSession.setStatus(SessionStatuses.ASKING_FOR_COMMENT)
      await mockSession.setPlace(mockPlace)
      await mockSession.setPlaceOptions([])
    })

    await expect(chain).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(mockSession.setStatus).not.toHaveBeenCalled()
    expect(mockSession.setPlace).not.toHaveBeenCalled()
    expect(mockSession.setPlaceOptions).not.toHaveBeenCalled()
  })
})

describe('ResponseContract.createService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCountFn.mockReset()
  })

  it('passes client_id as canonical digits-only string to ServiceRepository.create', async () => {
    const mockSession = buildMockSession('573001234567@c.us')

    const createdService = {
      id: 'svc-1',
      client_id: '573001234567',
      wp_client_id: 'wp-client-1',
      phone: '+573001234567',
      name: 'Test User',
      start_loc: mockPlace,
      status: 'pending',
    }

    ;(ServiceRepository.create as jest.Mock).mockResolvedValue(createdService)

    const contract = new ConcreteResponseContract(mockSession as any)
    contract['currentClient'] = mockClient

    await contract.createService(mockPlace)

    expect(ServiceRepository.create).toHaveBeenCalledTimes(1)

    const capturedService = (ServiceRepository.create as jest.Mock).mock.calls[0][0]
    expect(capturedService.client_id).toBe('573001234567')
    expect(capturedService.start_loc.city).toBe('popayan')
    expect(capturedService.start_loc.country).toBe('colombia')
  })

  it('persists client_completed_services_count with the value returned by the repo (happy path)', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    const completedCount = 7

    mockCountFn.mockResolvedValue(completedCount)
    MockedContainer.getServiceHistoryRepository.mockReturnValue({ count: mockCountFn })

    const createdService = {
      id: 'svc-2',
      client_id: '573001234567',
      wp_client_id: 'wp-client-1',
      phone: '+573001234567',
      name: 'Test User',
      start_loc: mockPlace,
      status: 'pending',
    }
    ;(ServiceRepository.create as jest.Mock).mockResolvedValue(createdService)

    const contract = new ConcreteResponseContract(mockSession as any)
    contract['currentClient'] = mockClient

    await contract.createService(mockPlace)

    expect(ServiceRepository.create).toHaveBeenCalledTimes(1)
    const capturedService = (ServiceRepository.create as jest.Mock).mock.calls[0][0]
    expect(capturedService.client_completed_services_count).toBe(completedCount)
  })

  it('persists client_completed_services_count = 0, still creates service, and calls Sentry.captureException when repo throws', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    const repoError = new Error('DB failure')

    mockCountFn.mockRejectedValue(repoError)
    MockedContainer.getServiceHistoryRepository.mockReturnValue({ count: mockCountFn })

    const createdService = {
      id: 'svc-3',
      client_id: '573001234567',
      wp_client_id: 'wp-client-1',
      phone: '+573001234567',
      name: 'Test User',
      start_loc: mockPlace,
      status: 'pending',
    }
    ;(ServiceRepository.create as jest.Mock).mockResolvedValue(createdService)

    const sentrySpy = jest.spyOn(Sentry, 'captureException')

    const contract = new ConcreteResponseContract(mockSession as any)
    contract['currentClient'] = mockClient

    await contract.createService(mockPlace)

    expect(ServiceRepository.create).toHaveBeenCalledTimes(1)
    const capturedService = (ServiceRepository.create as jest.Mock).mock.calls[0][0]
    expect(capturedService.client_completed_services_count).toBe(0)

    expect(sentrySpy).toHaveBeenCalledTimes(1)
    expect(sentrySpy).toHaveBeenCalledWith(repoError)
  })

  // spec scenario: "Stale turn does not create a service" (ASKING_FOR_COMMENT
  // path) — createService()'s success path never calls sendMessage, so the
  // assertTurnStillValid() gate immediately before ServiceRepository.create
  // (design D3 point 2) is the *only* thing protecting this write from a
  // superseded/COMPLETED/SUPPORT turn.
  it('does not create a service when the turn is stale (gate immediately before ServiceRepository.create)', async () => {
    const mockSession = buildMockSession('573001234567@c.us')
    mockSession.assertTurnStillValid = jest
      .fn()
      .mockRejectedValue(new DiscardedTurnError('superseded'))
    mockCountFn.mockResolvedValue(3)
    MockedContainer.getServiceHistoryRepository.mockReturnValue({ count: mockCountFn })

    const contract = new ConcreteResponseContract(mockSession as any)
    contract['currentClient'] = mockClient

    await expect(contract.createService(mockPlace)).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(ServiceRepository.create).not.toHaveBeenCalled()
    expect(mockSession.setService).not.toHaveBeenCalled()
  })
})
