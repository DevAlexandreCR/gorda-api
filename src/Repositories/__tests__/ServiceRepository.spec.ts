// Chainable fake for `Database.dbServices()`, mirroring WpNotificationRepository.spec.ts's
// approach: every intermediate chain node (orderByChild, limitToLast) records params as they
// accumulate, and `on`/`off` record the fully-accumulated params at that point in the chain,
// so the test can assert `off` detaches the exact same query (same params, same handler) that
// `on` attached (design D7, spec: chatbot-session-sync).
jest.mock('../../Services/firebase/Database', () => {
  type QueryParams = {
    orderBy?: string
    limit?: number
  }

  const onCalls: Array<{
    params: QueryParams
    eventType: string
    cb: (...args: unknown[]) => void
  }> = []
  const offCalls: Array<{
    params: QueryParams
    eventType: string
    cb: (...args: unknown[]) => void
  }> = []

  function createQueryNode(params: QueryParams) {
    return {
      orderByChild: (field: string) => createQueryNode({ ...params, orderBy: field }),
      limitToLast: (n: number) => createQueryNode({ ...params, limit: n }),
      on: (eventType: string, cb: (...args: unknown[]) => void) => {
        onCalls.push({ params: { ...params }, eventType, cb })
      },
      off: (eventType: string, cb: (...args: unknown[]) => void) => {
        offCalls.push({ params: { ...params }, eventType, cb })
      },
    }
  }

  return {
    __esModule: true,
    default: {
      dbServices: () => createQueryNode({}),
      __onCalls: onCalls,
      __offCalls: offCalls,
    },
  }
})

import Database from '../../Services/firebase/Database'
import ServiceRepository from '../ServiceRepository'

type QueryParams = { orderBy?: string; limit?: number }
type OnCall = { params: QueryParams; eventType: string; cb: (...args: unknown[]) => void }
type OffCall = { params: QueryParams; eventType: string; cb: (...args: unknown[]) => void }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onCalls = (Database as any).__onCalls as OnCall[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const offCalls = (Database as any).__offCalls as OffCall[]

describe('ServiceRepository.onServiceChanged (design D7, spec: chatbot-session-sync)', () => {
  beforeEach(() => {
    onCalls.length = 0
    offCalls.length = 0
  })

  it("attaches 'child_changed' with the given handler on an orderByChild('created_at').limitToLast(100) query", () => {
    const handler = jest.fn()

    ServiceRepository.onServiceChanged(handler)

    expect(onCalls).toHaveLength(1)
    expect(onCalls[0].eventType).toBe('child_changed')
    expect(onCalls[0].cb).toBe(handler)
    expect(onCalls[0].params).toEqual({ orderBy: 'created_at', limit: 100 })
  })

  it('returns an unsubscribe that detaches the identical query (same params) with the same handler', () => {
    const handler = jest.fn()

    const unsubscribe = ServiceRepository.onServiceChanged(handler)

    expect(offCalls).toHaveLength(0)
    unsubscribe()

    expect(offCalls).toHaveLength(1)
    expect(offCalls[0].eventType).toBe('child_changed')
    expect(offCalls[0].cb).toBe(handler)
    expect(offCalls[0].params).toEqual(onCalls[0].params)
  })

  it('builds an independent registration per call, so each unsubscribe detaches only its own handler', () => {
    const handlerA = jest.fn()
    const handlerB = jest.fn()

    const unsubscribeA = ServiceRepository.onServiceChanged(handlerA)
    const unsubscribeB = ServiceRepository.onServiceChanged(handlerB)

    unsubscribeA()

    expect(offCalls).toHaveLength(1)
    expect(offCalls[0].cb).toBe(handlerA)

    unsubscribeB()

    expect(offCalls).toHaveLength(2)
    expect(offCalls[1].cb).toBe(handlerB)
  })
})
