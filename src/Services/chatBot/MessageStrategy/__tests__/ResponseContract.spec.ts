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
    getInstance: jest.fn().mockReturnValue({}),
  },
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

jest.mock('../../../../Container/Container', () => ({
  default: { getPlaceRepository: jest.fn() },
}))

import { ResponseContract } from '../ResponseContract'
import ServiceRepository from '../../../../Repositories/ServiceRepository'
import { PlaceInterface } from '../../../../Interfaces/PlaceInterface'
import { WpMessage } from '../../../../Types/WpMessage'
import { ClientInterface } from '../../../../Interfaces/ClientInterface'

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
    sendMessage: jest.fn().mockResolvedValue(undefined),
  }
}

class ConcreteResponseContract extends ResponseContract {
  messageSupported = ['text']
  async processMessage(_message: WpMessage): Promise<void> {}
}

describe('ResponseContract.createService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
  })
})
