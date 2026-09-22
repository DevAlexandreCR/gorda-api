// Chainable fake for `Database.dbWpNotifications()`. The real firebase-admin SDK lets
// `.on`/`.off` be called at any chain depth, so every intermediate node (child, orderByChild,
// equalTo, limitToLast) exposes `on`/`off` alongside the next chain method, each recording the
// query params accumulated up to that point. This is what lets this test catch a regression
// where `offNotifications` drops `limitToLast(3)` on the detach query (recorded as `limit:
// undefined` instead of `limit: 3`), which is exactly the bug this change fixes.
jest.mock('../../Services/firebase/Database', () => {
  type QueryParams = {
    kind?: string
    orderBy?: string
    equalTo?: string
    limit?: number
  }

  const onCalls: Array<{
    params: QueryParams
    eventType: string
    cb: (...args: unknown[]) => void
  }> = []
  const offCalls: Array<{ params: QueryParams }> = []

  function createQueryNode(params: QueryParams) {
    return {
      child: (kind: string) => createQueryNode({ ...params, kind }),
      orderByChild: (field: string) => createQueryNode({ ...params, orderBy: field }),
      equalTo: (value: string) => createQueryNode({ ...params, equalTo: value }),
      limitToLast: (n: number) => createQueryNode({ ...params, limit: n }),
      on: (eventType: string, cb: (...args: unknown[]) => void) => {
        onCalls.push({ params: { ...params }, eventType, cb })
      },
      off: () => {
        offCalls.push({ params: { ...params } })
      },
    }
  }

  return {
    __esModule: true,
    default: {
      dbWpNotifications: () => createQueryNode({}),
      __onCalls: onCalls,
      __offCalls: offCalls,
    },
  }
})

import Database from '../../Services/firebase/Database'
import WpNotificationRepository from '../WpNotificationRepository'

type RecordedQueryParams = {
  kind?: string
  orderBy?: string
  equalTo?: string
  limit?: number
}

type OnCall = { params: RecordedQueryParams; eventType: string; cb: (...args: unknown[]) => void }
type OffCall = { params: RecordedQueryParams }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onCalls = (Database as any).__onCalls as OnCall[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const offCalls = (Database as any).__offCalls as OffCall[]

const wpClient = 'wp-client-1'

type OnMethod =
  | 'onServiceAssigned'
  | 'onServiceCanceled'
  | 'onServiceTerminated'
  | 'onNewService'
  | 'onDriverArrived'

const onMethods: Array<{ method: OnMethod; kind: string }> = [
  { method: 'onServiceAssigned', kind: 'assigned' },
  { method: 'onServiceCanceled', kind: 'canceled' },
  { method: 'onServiceTerminated', kind: 'terminated' },
  { method: 'onNewService', kind: 'new' },
  { method: 'onDriverArrived', kind: 'arrived' },
]

describe('WpNotificationRepository', () => {
  beforeEach(() => {
    onCalls.length = 0
    offCalls.length = 0
  })

  describe.each(onMethods)('$method', ({ method, kind }) => {
    it(`registers 'child_added' with the given handler on the wp_client-scoped, limit-3 query for kind '${kind}'`, () => {
      const handler = jest.fn()

      WpNotificationRepository[method](wpClient, handler)

      expect(onCalls).toHaveLength(1)
      expect(onCalls[0].eventType).toBe('child_added')
      expect(onCalls[0].cb).toBe(handler)
      expect(onCalls[0].params).toEqual({
        kind,
        orderBy: 'wp_client_id',
        equalTo: wpClient,
        limit: 3,
      })
    })
  })

  describe('offNotifications', () => {
    it('detaches the identical query registered by each on* method, once per kind', () => {
      WpNotificationRepository.onServiceAssigned(wpClient, jest.fn())
      WpNotificationRepository.onServiceCanceled(wpClient, jest.fn())
      WpNotificationRepository.onServiceTerminated(wpClient, jest.fn())
      WpNotificationRepository.onNewService(wpClient, jest.fn())
      WpNotificationRepository.onDriverArrived(wpClient, jest.fn())

      const onParamsByKind = new Map(onCalls.map((call) => [call.params.kind, call.params]))
      expect(onParamsByKind.size).toBe(5)

      WpNotificationRepository.offNotifications(wpClient)

      expect(offCalls).toHaveLength(5)

      const offKinds = offCalls.map((call) => call.params.kind)
      expect(new Set(offKinds)).toEqual(
        new Set(['assigned', 'canceled', 'terminated', 'new', 'arrived'])
      )

      for (const call of offCalls) {
        expect(call.params).toEqual(onParamsByKind.get(call.params.kind))
      }
    })
  })
})
