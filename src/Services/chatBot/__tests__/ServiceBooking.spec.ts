// Mock Session before any module that triggers the circular Session <-> SessionRepository
// dependency (Session imports SessionRepository directly; SessionRepository also reaches
// Session indirectly via ChatRepository, and via TurnDispatcher/dispatchTurn).
jest.mock('../../../Models/Session', () => {
  const SessionStatuses = {
    BOOKING: 'booking',
    REQUESTING_SERVICE: 'requesting_service',
    SERVICE_IN_PROGRESS: 'service_in_progress',
    COMPLETED: 'completed',
    SUPPORT: 'support',
  }
  class MockSession {
    static STATUS_BOOKING = SessionStatuses.BOOKING
    static STATUS_REQUESTING_SERVICE = SessionStatuses.REQUESTING_SERVICE
    static STATUS_SERVICE_IN_PROGRESS = SessionStatuses.SERVICE_IN_PROGRESS
    static STATUS_COMPLETED = SessionStatuses.COMPLETED
    static STATUS_SUPPORT = SessionStatuses.SUPPORT
  }
  return { __esModule: true, default: MockSession }
})

jest.mock('../../../Repositories/ServiceRepository', () => ({
  create: jest.fn(),
}))

jest.mock('../../store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      findCountryByCity: jest.fn().mockReturnValue('colombia'),
    }),
  },
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

jest.mock('../../../Container/Container', () => ({
  __esModule: true,
  default: {
    getServiceHistoryRepository: jest.fn(),
  },
}))

import { bookService } from '../ServiceBooking'
import ServiceRepository from '../../../Repositories/ServiceRepository'
import { PlaceInterface } from '../../../Interfaces/PlaceInterface'
import { ClientInterface } from '../../../Interfaces/ClientInterface'
import * as Sentry from '@sentry/node'
import { DiscardedTurnError } from '../turns/DiscardedTurnError'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MockedContainer = require('../../../Container/Container').default
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
    id: 'session-1',
    chat_id: chatId,
    wp_client_id: 'wp-client-1',
    service_id: null as string | null,
    setService: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    assertTurnStillValid: jest.fn().mockResolvedValue(undefined),
  }
}

describe('ServiceBooking.bookService', () => {
  const mockSendMessage = jest.fn().mockResolvedValue(undefined)

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

    await bookService(mockSession as any, {
      place: mockPlace,
      client: mockClient,
      sendMessage: mockSendMessage,
    })

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

    await bookService(mockSession as any, {
      place: mockPlace,
      client: mockClient,
      sendMessage: mockSendMessage,
    })

    expect(ServiceRepository.create).toHaveBeenCalledTimes(1)
    const capturedService = (ServiceRepository.create as jest.Mock).mock.calls[0][0]
    expect(capturedService.client_completed_services_count).toBe(completedCount)

    expect(mockSession.setService).toHaveBeenCalledWith(createdService.id)
    expect(mockSession.setStatus).toHaveBeenCalledWith('requesting_service')

    // design D7 / spec "Service creation turn sends the catalog confirmation only":
    // bookService never sends SERVICE_CREATED (or any message) itself on the success
    // path — the RTDB `new` notification (WhatsAppClient.onNewService) is the single
    // source of that confirmation.
    expect(mockSendMessage).not.toHaveBeenCalled()
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

    await bookService(mockSession as any, {
      place: mockPlace,
      client: mockClient,
      sendMessage: mockSendMessage,
    })

    expect(ServiceRepository.create).toHaveBeenCalledTimes(1)
    const capturedService = (ServiceRepository.create as jest.Mock).mock.calls[0][0]
    expect(capturedService.client_completed_services_count).toBe(0)

    expect(sentrySpy).toHaveBeenCalledTimes(1)
    expect(sentrySpy).toHaveBeenCalledWith(repoError)
  })

  // spec scenario: "Stale turn does not create a service" (ASKING_FOR_COMMENT
  // path) — bookService's success path never calls sendMessage, so the
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

    await expect(
      bookService(mockSession as any, {
        place: mockPlace,
        client: mockClient,
        sendMessage: mockSendMessage,
      })
    ).rejects.toBeInstanceOf(DiscardedTurnError)

    expect(ServiceRepository.create).not.toHaveBeenCalled()
    expect(mockSession.setService).not.toHaveBeenCalled()
  })
})
