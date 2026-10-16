jest.mock('../../Models/Client', () => ({
  findOne: jest.fn(),
  findByPk: jest.fn(),
  findAll: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
}))

import SequelizeClient from '../../Models/Client'
import ClientRepository from '../ClientRepository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClientModel(overrides: Record<string, any> = {}) {
  const plain = {
    id: '573001234567',
    name: 'Usuario',
    phone: '+573001234567',
    photoUrl: '',
    wpUserId: null,
    ...overrides,
  }
  return { get: (_opts: any) => plain }
}

function makeRepository() {
  const transaction = jest.fn(async (callback: (t: any) => Promise<void>) => {
    await callback({} as any)
  })
  const repository = new ClientRepository({ transaction } as any)
  return { repository, transaction }
}

// ---------------------------------------------------------------------------
// findByUserId()
// ---------------------------------------------------------------------------

describe('ClientRepository.findByUserId()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('looks up the client by an exact wpUserId match, no digit-stripping', async () => {
    const model = makeClientModel({ id: '573001234567', wpUserId: 'CO.4510540692592955' })
    ;(SequelizeClient.findOne as jest.Mock).mockResolvedValue(model)

    const { repository } = makeRepository()
    const client = await repository.findByUserId('CO.4510540692592955')

    expect(SequelizeClient.findOne).toHaveBeenCalledWith({
      where: { wpUserId: 'CO.4510540692592955' },
    })
    expect(client?.wpUserId).toBe('CO.4510540692592955')
  })

  it('returns null when nothing holds that userId', async () => {
    ;(SequelizeClient.findOne as jest.Mock).mockResolvedValue(null)

    const { repository } = makeRepository()
    const client = await repository.findByUserId('CO.unknown')

    expect(client).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setUserId()
// ---------------------------------------------------------------------------

describe('ClientRepository.setUserId()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('clears a prior holder of the userId before setting it on the target', async () => {
    const targetModel = makeClientModel({
      id: '573001234567',
      name: 'Juan',
      photoUrl: 'https://photo.example/juan.png',
      wpUserId: 'CO.4510540692592955',
    })
    ;(SequelizeClient.update as jest.Mock).mockResolvedValue([1])
    ;(SequelizeClient.findByPk as jest.Mock).mockResolvedValue(targetModel)

    const { repository, transaction } = makeRepository()
    const client = await repository.setUserId('573001234567', 'CO.4510540692592955')

    expect(transaction).toHaveBeenCalledTimes(1)

    const [clearCall, setCall] = (SequelizeClient.update as jest.Mock).mock.calls
    expect(clearCall[0]).toEqual({ wpUserId: null })
    expect(clearCall[1].where.wpUserId).toBe('CO.4510540692592955')
    expect(clearCall[1].where.id).not.toBe('573001234567')

    expect(setCall[0]).toEqual({ wpUserId: 'CO.4510540692592955' })
    expect(setCall[1].where).toEqual({ id: '573001234567' })

    expect(SequelizeClient.findByPk).toHaveBeenCalledWith('573001234567')
    expect(client.wpUserId).toBe('CO.4510540692592955')
  })

  it('leaves name and photoUrl on the target row untouched', async () => {
    const targetModel = makeClientModel({
      id: '573001234567',
      name: 'Juan',
      photoUrl: 'https://photo.example/juan.png',
      wpUserId: 'CO.4510540692592955',
    })
    ;(SequelizeClient.update as jest.Mock).mockResolvedValue([1])
    ;(SequelizeClient.findByPk as jest.Mock).mockResolvedValue(targetModel)

    const { repository } = makeRepository()
    const client = await repository.setUserId('573001234567', 'CO.4510540692592955')

    const calls = (SequelizeClient.update as jest.Mock).mock.calls
    for (const [attrs] of calls) {
      expect(attrs).not.toHaveProperty('name')
      expect(attrs).not.toHaveProperty('photoUrl')
    }

    expect(client.name).toBe('Juan')
    expect(client.photoUrl).toBe('https://photo.example/juan.png')
  })

  it('throws when the target row no longer exists after the transaction', async () => {
    ;(SequelizeClient.update as jest.Mock).mockResolvedValue([1])
    ;(SequelizeClient.findByPk as jest.Mock).mockResolvedValue(null)

    const { repository } = makeRepository()

    await expect(repository.setUserId('573001234567', 'CO.4510540692592955')).rejects.toThrow(
      'Client not found'
    )
  })
})

// ---------------------------------------------------------------------------
// relinkUserId()
// ---------------------------------------------------------------------------

describe('ClientRepository.relinkUserId()', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('moves the link from the previous holder to the current userId and returns the client', async () => {
    const previousHolder = makeClientModel({
      id: '573001111111',
      wpUserId: 'CO.previous',
    })
    const relinkedModel = makeClientModel({
      id: '573001111111',
      wpUserId: 'CO.current',
    })
    ;(SequelizeClient.findOne as jest.Mock).mockResolvedValue(previousHolder)
    ;(SequelizeClient.update as jest.Mock).mockResolvedValue([1])
    ;(SequelizeClient.findByPk as jest.Mock).mockResolvedValue(relinkedModel)

    const { repository } = makeRepository()
    const client = await repository.relinkUserId('CO.previous', 'CO.current')

    expect(SequelizeClient.findOne).toHaveBeenCalledWith({ where: { wpUserId: 'CO.previous' } })
    expect(client?.id).toBe('573001111111')
    expect(client?.wpUserId).toBe('CO.current')
  })

  it('returns null without throwing when previousUserId is held by no one', async () => {
    ;(SequelizeClient.findOne as jest.Mock).mockResolvedValue(null)

    const { repository } = makeRepository()
    const client = await repository.relinkUserId('CO.unknown', 'CO.current')

    expect(client).toBeNull()
    expect(SequelizeClient.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// buildPayload() (via store())
// ---------------------------------------------------------------------------

describe('ClientRepository.store() — wpUserId payload handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('omits wpUserId from the upsert payload when it is undefined', async () => {
    const model = makeClientModel({ id: '573001234567' })
    ;(SequelizeClient.upsert as jest.Mock).mockResolvedValue([model])

    const { repository } = makeRepository()
    await repository.store({ id: '573001234567', name: 'Usuario', phone: '+573001234567' })

    const [payload] = (SequelizeClient.upsert as jest.Mock).mock.calls[0]
    expect(payload).not.toHaveProperty('wpUserId')
  })

  it('includes an explicit null wpUserId in the upsert payload', async () => {
    const model = makeClientModel({ id: '573001234567' })
    ;(SequelizeClient.upsert as jest.Mock).mockResolvedValue([model])

    const { repository } = makeRepository()
    await repository.store({
      id: '573001234567',
      name: 'Usuario',
      phone: '+573001234567',
      wpUserId: null,
    })

    const [payload] = (SequelizeClient.upsert as jest.Mock).mock.calls[0]
    expect(payload).toHaveProperty('wpUserId', null)
  })

  it('includes a provided wpUserId in the upsert payload', async () => {
    const model = makeClientModel({ id: '573001234567', wpUserId: 'CO.4510540692592955' })
    ;(SequelizeClient.upsert as jest.Mock).mockResolvedValue([model])

    const { repository } = makeRepository()
    await repository.store({
      id: '573001234567',
      name: 'Usuario',
      phone: '+573001234567',
      wpUserId: 'CO.4510540692592955',
    })

    const [payload] = (SequelizeClient.upsert as jest.Mock).mock.calls[0]
    expect(payload).toHaveProperty('wpUserId', 'CO.4510540692592955')
  })
})
