jest.mock('../../../Container/Container', () => {
  const mockClientRepository = {
    index: jest.fn().mockResolvedValue([]),
    findByPhone: jest.fn(),
    store: jest.fn(),
    setUserId: jest.fn(),
    relinkUserId: jest.fn(),
    create: jest.fn(),
  }

  return {
    __esModule: true,
    default: {
      getPlaceRepository: jest.fn(() => ({})),
      getPlaceSearchRepository: jest.fn(() => ({})),
      getClientRepository: jest.fn(() => mockClientRepository),
      getDriverRecordRepository: jest.fn(() => ({ index: jest.fn().mockResolvedValue([]) })),
      getMasterDataRepository: jest.fn(() => ({
        getChatBotMessagesMap: jest.fn().mockResolvedValue(new Map()),
        listWpClients: jest.fn().mockResolvedValue([]),
        getBranches: jest.fn().mockResolvedValue([]),
      })),
    },
  }
})

import Container from '../../../Container/Container'
import { Store } from '../Store'
import { ClientInterface } from '../../../Interfaces/ClientInterface'

type MockClientRepository = {
  index: jest.Mock
  findByPhone: jest.Mock
  store: jest.Mock
  setUserId: jest.Mock
  relinkUserId: jest.Mock
  create: jest.Mock
}

// `Container.getClientRepository()` always returns the same fake object, so
// grabbing it once here gives direct access to the mocks' call assertions.
const mockClientRepository = Container.getClientRepository() as unknown as MockClientRepository

function makeClient(overrides: Partial<ClientInterface> = {}): ClientInterface {
  return {
    id: '573001234567',
    name: 'Usuario',
    phone: '+573001234567',
    photoUrl: '',
    wpUserId: null,
    ...overrides,
  }
}

// Bypasses the private constructor the same way `getInstance()` would, but
// gives each test a fresh, isolated instance instead of sharing the module
// singleton across the whole file.
function newStore(): Store {
  return new (Store as unknown as new () => Store)()
}

describe('Store (BSUID support — support-wp-bsuid-phone-request, section 7)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockClientRepository.index.mockResolvedValue([])
  })

  describe('cacheClient', () => {
    it('indexes a client with wpUserId into clientsByUserId and never into the phone-keyed clients map', () => {
      const store = newStore()
      const client = makeClient({ wpUserId: 'CO.4510540692592955' })

      // cacheClient is private; exercised directly like the other store/__tests__
      // specs in this codebase exercise private helpers via `as any`.
      ;(store as unknown as { cacheClient(c: ClientInterface): void }).cacheClient(client)

      expect(store.clientsByUserId.get('CO.4510540692592955')).toBe(client)
      expect(store.clients.has('CO.4510540692592955')).toBe(false)
      expect(Array.from(store.clients.values())).not.toContain(
        expect.objectContaining({ wpUserId: 'CO.4510540692592955' })
      )
    })
  })

  describe('findClientByUserId', () => {
    it('returns the client cached under that BSUID', () => {
      const store = newStore()
      const client = makeClient({ wpUserId: 'CO.abc' })
      ;(store as unknown as { cacheClient(c: ClientInterface): void }).cacheClient(client)

      expect(store.findClientByUserId('CO.abc')).toBe(client)
      expect(store.findClientByUserId('CO.unknown')).toBeUndefined()
    })
  })

  describe('linkClientUserId', () => {
    it('updates the DB via setUserId and the cache, clearing the displaced holder in place so it cannot ping-pong', async () => {
      const store = newStore()

      const clientA = makeClient({
        id: '573001111111',
        phone: '+573001111111',
        wpUserId: 'CO.shared',
      })
      mockClientRepository.setUserId.mockResolvedValueOnce(clientA)
      await store.linkClientUserId(clientA.id, 'CO.shared')
      expect(store.clientsByUserId.get('CO.shared')).toBe(clientA)
      expect(store.clients.get(clientA.phone)).toBe(clientA)

      const clientB = makeClient({
        id: '573002222222',
        phone: '+573002222222',
        wpUserId: 'CO.shared',
      })
      mockClientRepository.setUserId.mockResolvedValueOnce(clientB)
      const result = await store.linkClientUserId(clientB.id, 'CO.shared')

      expect(mockClientRepository.setUserId).toHaveBeenCalledWith(clientB.id, 'CO.shared')
      expect(result).toBe(clientB)
      expect(store.clientsByUserId.get('CO.shared')).toBe(clientB)
      expect(
        Array.from(store.clientsByUserId.values()).filter((c) => c.id === clientA.id)
      ).toHaveLength(0)

      // The displaced holder's cached object is mutated in place (shared
      // reference across the `clients` phone-keyed cache), so a later
      // `from`-bearing message for A never sees it still "holding" the BSUID.
      expect(clientA.wpUserId).toBeNull()
      expect(store.clients.get(clientA.phone)?.wpUserId).toBeNull()
    })
  })

  describe('storeOrLinkClient', () => {
    it('links onto an existing client without changing its name', async () => {
      const store = newStore()
      const existing = makeClient({
        id: '573003333333',
        phone: '+573003333333',
        name: 'Pedro',
        wpUserId: null,
      })
      ;(store as unknown as { cacheClient(c: ClientInterface): void }).cacheClient(existing)

      const linked = { ...existing, wpUserId: 'CO.new' }
      mockClientRepository.setUserId.mockResolvedValue(linked)

      const result = await store.storeOrLinkClient({
        phone: existing.phone,
        name: 'Someone Else',
        userId: 'CO.new',
      })

      expect(mockClientRepository.setUserId).toHaveBeenCalledWith(existing.id, 'CO.new')
      expect(mockClientRepository.store).not.toHaveBeenCalled()
      expect(result.name).toBe('Pedro')
    })

    it('creates a new client WITHOUT wpUserId, then links it via setUserId, never risking a duplicate-BSUID insert', async () => {
      const store = newStore()
      mockClientRepository.findByPhone.mockResolvedValue(null)

      const createdRaw = makeClient({
        id: '573004444444',
        phone: '+573004444444',
        name: 'Usuario',
        wpUserId: null,
      })

      // Mimics the DB's unique partial index on `wp_user_id`: a `store()`
      // call that carries `wpUserId` could collide with another client that
      // already holds it. The create branch must never pass `wpUserId` to
      // `store()` — linking happens afterward through `setUserId`, whose
      // transaction clears any prior holder first (finding 4).
      mockClientRepository.store.mockImplementation((payload: Record<string, unknown>) => {
        if ('wpUserId' in payload && payload.wpUserId !== undefined) {
          throw new Error(
            'duplicate key value violates unique constraint "clients_wp_user_id_unique"'
          )
        }
        return Promise.resolve(createdRaw)
      })

      const linked = { ...createdRaw, wpUserId: 'CO.brand-new' }
      mockClientRepository.setUserId.mockResolvedValue(linked)

      const result = await store.storeOrLinkClient({
        phone: '573004444444',
        userId: 'CO.brand-new',
      })

      expect(mockClientRepository.store).toHaveBeenCalledWith({
        id: '573004444444',
        phone: '573004444444',
        name: 'Usuario',
      })
      expect(mockClientRepository.setUserId).toHaveBeenCalledWith(createdRaw.id, 'CO.brand-new')
      expect(result).toBe(linked)
      expect(store.clientsByUserId.get('CO.brand-new')).toBe(linked)
    })
  })

  describe('rememberUserIdForPhone + createClient', () => {
    it('links the remembered BSUID onto the newly created client', async () => {
      const store = newStore()
      store.rememberUserIdForPhone('+573005555555', 'CO.pending')

      const createdRaw = makeClient({
        id: '573005555555',
        phone: '+573005555555',
        wpUserId: null,
      })
      mockClientRepository.create.mockResolvedValue(createdRaw)

      const linked = { ...createdRaw, wpUserId: 'CO.pending' }
      mockClientRepository.setUserId.mockResolvedValue(linked)

      const result = await store.createClient({
        id: '573005555555',
        pushname: 'Usuario',
        number: '573005555555',
        getProfilePicUrl: () => '',
      })

      expect(mockClientRepository.setUserId).toHaveBeenCalledWith(createdRaw.id, 'CO.pending')
      expect(result.wpUserId).toBe('CO.pending')
      expect(store.pendingUserIdByPhone.has('+573005555555')).toBe(false)
    })
  })
})
