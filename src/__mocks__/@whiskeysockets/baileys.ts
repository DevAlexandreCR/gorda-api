/**
 * Manual Jest mock for the ESM-only `@whiskeysockets/baileys` package.
 *
 * ts-jest's CommonJS runtime cannot `require` an ESM package regardless of the
 * Node version, so tests must never load the real library. This mock exposes
 * jest fns/fakes for every symbol the Baileys transport imports.
 *
 * `isPnUser`, `isLidUser`, `jidNormalizedUser` and `toNumber` mirror the real
 * implementations (JID-server-suffix checks, Long-shaped number coercion)
 * because later LID-resolution and timestamp-parsing tests depend on
 * realistic behavior, not blind stubs.
 */

export interface FakeBaileysSocket {
  ev: {
    on: jest.Mock
    off: jest.Mock
    emit: jest.Mock
  }
  sendMessage: jest.Mock
  sendPresenceUpdate: jest.Mock
  logout: jest.Mock
  end: jest.Mock
  signalRepository: {
    lidMapping: {
      getPNForLID: jest.Mock
    }
  }
  user?: { id: string; name: string }
}

function createFakeSocket(): FakeBaileysSocket {
  return {
    ev: {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendPresenceUpdate: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    end: jest.fn(),
    signalRepository: {
      lidMapping: {
        getPNForLID: jest.fn().mockResolvedValue(null),
      },
    },
  }
}

const makeWASocket = jest.fn(() => createFakeSocket())

export default makeWASocket
export { makeWASocket }

export const useMultiFileAuthState = jest.fn().mockResolvedValue({
  state: { creds: {}, keys: {} },
  saveCreds: jest.fn().mockResolvedValue(undefined),
})

export const makeCacheableSignalKeyStore = jest.fn((keys: unknown) => keys)

export const fetchLatestBaileysVersion = jest.fn().mockResolvedValue({
  version: [2, 3000, 0],
  isLatest: true,
})

export const Browsers = {
  ubuntu: jest.fn((browser: string) => ['Ubuntu', browser, '22.04.4']),
  macOS: jest.fn((browser: string) => ['Mac OS', browser, '10.15.7']),
  appropriate: jest.fn((browser: string) => ['Ubuntu', browser, '22.04.4']),
}

// Mirrors the real enum values (status codes from @hapi/boom close reasons).
export const DisconnectReason = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
  forbidden: 403,
  unavailableService: 503,
}

export const isPnUser = jest.fn((jid?: string): boolean => !!jid && jid.endsWith('@s.whatsapp.net'))

export const isLidUser = jest.fn((jid?: string): boolean => !!jid && jid.endsWith('@lid'))

export const jidNormalizedUser = jest.fn((jid?: string): string => {
  if (!jid) {
    return ''
  }
  const [userPart, server] = jid.split('@')
  if (!server) {
    return ''
  }
  const user = userPart.split(':')[0]
  const normalizedServer = server === 'c.us' ? 's.whatsapp.net' : server
  return `${user}@${normalizedServer}`
})

interface LongLike {
  toNumber?: () => number
  low?: number
}

export const toNumber = jest.fn((value: number | LongLike | null | undefined): number => {
  if (typeof value === 'object' && value !== null) {
    return typeof value.toNumber === 'function' ? value.toNumber() : value.low || 0
  }
  return value || 0
})

export const delay = jest.fn(async (_ms: number): Promise<void> => Promise.resolve())

export const isJidBroadcast = jest.fn(
  (jid?: string): boolean => !!jid && jid.endsWith('@broadcast')
)

export const isJidNewsletter = jest.fn(
  (jid?: string): boolean => !!jid && jid.endsWith('@newsletter')
)
