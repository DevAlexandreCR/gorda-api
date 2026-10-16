import BsuidPendingStore from '../BsuidPendingStore'
import { WebhookMessage } from '../resolveOfficialSender'

const makeMessage = (id: string): WebhookMessage => ({
  id,
  from_user_id: 'CO.4510540692592955',
  type: 'text',
  text: { body: 'hola' },
})

describe('BsuidPendingStore', () => {
  const key = 'wp-client-1:CO.4510540692592955'

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T00:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('canRequest is true initially', () => {
    expect(BsuidPendingStore.canRequest(key)).toBe(true)
  })

  it('canRequest is false immediately after markRequested, true again after 10 minutes', () => {
    BsuidPendingStore.markRequested(key)
    expect(BsuidPendingStore.canRequest(key)).toBe(false)

    jest.setSystemTime(new Date('2026-10-15T00:09:59Z'))
    expect(BsuidPendingStore.canRequest(key)).toBe(false)

    jest.setSystemTime(new Date('2026-10-15T00:10:00Z'))
    expect(BsuidPendingStore.canRequest(key)).toBe(true)
  })

  it('rememberPending then takePending returns the stored message, second call returns undefined', () => {
    const message = makeMessage('wamid.1')
    BsuidPendingStore.rememberPending(key, message, 'Test User')

    const taken = BsuidPendingStore.takePending(key)
    expect(taken?.message).toBe(message)
    expect(taken?.profileName).toBe('Test User')

    expect(BsuidPendingStore.takePending(key)).toBeUndefined()
  })

  it('a pending message older than 30 minutes is not returned', () => {
    const message = makeMessage('wamid.2')
    BsuidPendingStore.rememberPending(key, message)

    jest.setSystemTime(new Date('2026-10-15T00:30:00Z'))
    expect(BsuidPendingStore.takePending(key)).toBeUndefined()
  })

  it('calling rememberPending twice keeps only the latest message', () => {
    const first = makeMessage('wamid.first')
    const second = makeMessage('wamid.second')

    BsuidPendingStore.rememberPending(key, first)
    BsuidPendingStore.rememberPending(key, second)

    const taken = BsuidPendingStore.takePending(key)
    expect(taken?.message).toBe(second)
  })
})
