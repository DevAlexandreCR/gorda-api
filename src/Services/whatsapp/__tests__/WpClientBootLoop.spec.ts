import * as Sentry from '@sentry/node'
import { initializeWpClients, InitializableWpService } from '../WpClientBootLoop'
import { WpClient } from '../../../Interfaces/WpClient'
import { ClientDictionary } from '../../../Interfaces/ClientDiccionary'
import { WpClients } from '../constants/WPClients'

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}))

function makeWpClient(overrides: Partial<WpClient> = {}): WpClient {
  return {
    id: 'client-1',
    alias: 'Test client',
    wpNotifications: false,
    full: false,
    chatBot: false,
    assistant: false,
    agentInTrip: false,
    service: WpClients.BAILEYS,
    ...overrides,
  }
}

class FakeWpService implements InitializableWpService {
  setWpClient = jest.fn()
  initClient = jest.fn()
}

describe('initializeWpClients (spec: wp-baileys-transport - Supported transports)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('isolates a throwing line: later lines are still initialized (scenario: Unknown transport value is isolated)', () => {
    const badClient = makeWpClient({ id: 'bad-line', service: 'unknown-service' as WpClients })
    const goodClient = makeWpClient({ id: 'good-line' })
    const clients: ClientDictionary = {
      [badClient.id]: badClient,
      [goodClient.id]: goodClient,
    }
    const wpServices: Record<string, FakeWpService> = {}
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    const createWpService = jest.fn((client: WpClient) => {
      if (client.id === badClient.id) {
        throw new Error(`Unsupported WhatsApp transport: ${client.service}`)
      }
      return new FakeWpService()
    })
    const onCreated = jest.fn()

    initializeWpClients(clients, wpServices, createWpService, onCreated)

    expect(wpServices[badClient.id]).toBeUndefined()
    expect(wpServices[goodClient.id]).toBeInstanceOf(FakeWpService)
    expect(wpServices[goodClient.id].setWpClient).toHaveBeenCalledWith(goodClient)
    expect(wpServices[goodClient.id].initClient).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(goodClient, wpServices[goodClient.id])

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to initialize WhatsApp line',
      expect.objectContaining({ wpClientId: badClient.id, error: expect.any(Error) })
    )
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error))

    consoleErrorSpy.mockRestore()
  })

  it('isolates a throw from setWpClient/initClient on an already-created line without affecting other lines', () => {
    const throwingExisting = makeWpClient({ id: 'existing-line' })
    const newClient = makeWpClient({ id: 'new-line' })
    const clients: ClientDictionary = {
      [throwingExisting.id]: throwingExisting,
      [newClient.id]: newClient,
    }

    const existingService = new FakeWpService()
    existingService.setWpClient.mockImplementation(() => {
      throw new Error('boom on setWpClient')
    })
    const wpServices: Record<string, FakeWpService> = {
      [throwingExisting.id]: existingService,
    }
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    const createWpService = jest.fn(() => new FakeWpService())

    initializeWpClients(clients, wpServices, createWpService)

    expect(existingService.setWpClient).toHaveBeenCalledWith(throwingExisting)
    expect(wpServices[newClient.id]).toBeInstanceOf(FakeWpService)
    expect(wpServices[newClient.id].initClient).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
  })
})
