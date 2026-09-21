jest.mock('../../../../queue/QueueService', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn().mockReturnValue({
      addQueue: jest.fn(),
      addWorker: jest.fn(),
      add: jest.fn(),
    }),
  },
}))

jest.mock('../../../../../Helpers/FileHelper', () => ({
  FileHelper: { removeFolder: jest.fn() },
}))

jest.mock('../../../../../Repositories/IgnoredInboundMessageAuditRepository', () => ({
  __esModule: true,
  default: { recordIgnoredEvent: jest.fn().mockResolvedValue(undefined) },
}))

import { BaileysClient } from '../BaileysClient'
import { WpClient } from '../../../../../Interfaces/WpClient'
import { WpClients } from '../../../constants/WPClients'
import { WpEvents } from '../../../constants/WpEvents'
import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys'
import QueueService from '../../../../queue/QueueService'
import { FileHelper } from '../../../../../Helpers/FileHelper'
import IgnoredInboundMessageAuditRepository from '../../../../../Repositories/IgnoredInboundMessageAuditRepository'

const wpClient: WpClient = {
  id: 'wp-client-1',
  alias: 'Test Client',
  wpNotifications: false,
  full: false,
  chatBot: true,
  assistant: false,
  agentInTrip: false,
  service: WpClients.BAILEYS,
}

describe('BaileysClient.initialize (spec: wp-baileys-transport - History sync disabled / Sent-message cache replaces the on-disk store)', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('passes syncFullHistory: false to makeWASocket and binds no store to the socket', async () => {
    const client = new BaileysClient(wpClient)

    await client.initialize()

    expect(makeWASocket).toHaveBeenCalledTimes(1)
    const socketConfig = (makeWASocket as jest.Mock).mock.calls[0][0]
    expect(socketConfig.syncFullHistory).toBe(false)

    const fakeSocket = (makeWASocket as jest.Mock).mock.results[0].value
    // A bound `makeInMemoryStore` would additionally register store-only listeners
    // (e.g. `messaging-history.set`, `chats.upsert`, `contacts.upsert`); only the
    // three listeners the client itself needs should be registered.
    const boundEvents = fakeSocket.ev.on.mock.calls.map(([event]: [string]) => event)
    expect(boundEvents).toEqual(['creds.update', 'connection.update', 'messages.upsert'])
  })
})

describe('BaileysClient.sendTypingIndicator (spec: chatbot-typing-indicator - Baileys transport sends a composing presence)', () => {
  it('sends a composing presence update to the chat', async () => {
    const client = new BaileysClient(wpClient)

    // The real socket is only created by initialize(); stub it here.
    const clientSock = { sendPresenceUpdate: jest.fn().mockResolvedValue(undefined) }
    ;(client as any).clientSock = clientSock

    await expect(
      client.sendTypingIndicator('573001234567@s.whatsapp.net', 'wamid.HBgMOTI=')
    ).resolves.toBeUndefined()

    expect(clientSock.sendPresenceUpdate).toHaveBeenCalledTimes(1)
    expect(clientSock.sendPresenceUpdate).toHaveBeenCalledWith(
      'composing',
      '573001234567@s.whatsapp.net'
    )
  })

  it('does not throw when the presence update is rejected', async () => {
    const client = new BaileysClient(wpClient)

    const clientSock = {
      sendPresenceUpdate: jest.fn().mockRejectedValue(new Error('socket disconnected')),
    }
    ;(client as any).clientSock = clientSock

    await expect(
      client.sendTypingIndicator('573001234567@s.whatsapp.net', 'wamid.HBgMOTI=')
    ).resolves.toBeUndefined()

    expect(clientSock.sendPresenceUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('BaileysClient sent-message cache (spec: wp-baileys-transport - Sent-message cache replaces the on-disk store)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  async function createInitializedClient() {
    const client = new BaileysClient(wpClient)
    await client.initialize()

    const socketCalls = (makeWASocket as jest.Mock).mock.results
    const sock = socketCalls[socketCalls.length - 1].value

    const addWorkerMock = (QueueService.getInstance() as any).addWorker as jest.Mock
    const workerCalls = addWorkerMock.mock.calls
    const worker = workerCalls[workerCalls.length - 1][1] as (data: any) => Promise<void>

    return { client, sock, worker }
  }

  it('hit: returns the content of a message this client recently sent', async () => {
    const { client, sock, worker } = await createInitializedClient()
    sock.sendMessage.mockResolvedValueOnce({
      key: { remoteJid: '573001234567@s.whatsapp.net', id: 'WAMID1' },
      message: { conversation: 'hello' },
    })

    await worker({ phoneNumber: '573001234567@s.whatsapp.net', message: { message: 'hello' } })

    const result = await (client as any).getMessage({
      remoteJid: '573001234567@s.whatsapp.net',
      id: 'WAMID1',
    })
    expect(result).toEqual({ conversation: 'hello' })
  })

  it('miss: returns undefined for a message id it never sent', async () => {
    const { client } = await createInitializedClient()

    const result = await (client as any).getMessage({
      remoteJid: '573001234567@s.whatsapp.net',
      id: 'NEVER-SENT',
    })
    expect(result).toBeUndefined()
  })

  it('eviction: drops the oldest entry once the cache exceeds its cap of ~500', async () => {
    const { client } = await createInitializedClient()

    for (let i = 0; i <= 500; i++) {
      ;(client as any).cacheSentMessage(
        { remoteJid: 'jid', id: `MSG-${i}` },
        { conversation: `body-${i}` }
      )
    }

    const oldest = await (client as any).getMessage({ remoteJid: 'jid', id: 'MSG-0' })
    const newest = await (client as any).getMessage({ remoteJid: 'jid', id: 'MSG-500' })

    expect(oldest).toBeUndefined()
    expect(newest).toEqual({ conversation: 'body-500' })
  })

  it('serves a cache hit when getMessage is invoked detached from the instance', async () => {
    const { client, sock, worker } = await createInitializedClient()
    sock.sendMessage.mockResolvedValueOnce({
      key: { remoteJid: '573001234567@s.whatsapp.net', id: 'WAMID2' },
      message: { conversation: 'detached' },
    })

    await worker({ phoneNumber: '573001234567@s.whatsapp.net', message: { message: 'detached' } })

    // Extract the callback and invoke it with no receiver, exactly as `makeWASocket`
    // does internally, to prove it does not rely on a bound `this`.
    const fn = (client as any).getMessage
    const result = await fn({ remoteJid: '573001234567@s.whatsapp.net', id: 'WAMID2' })

    expect(result).toEqual({ conversation: 'detached' })
  })
})

describe('BaileysClient outbound rendering (spec: wp-interactive-fallback - Interactive catalog messages render as numbered text on Baileys)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('Reply buttons: clientSock.sendMessage receives the rendered numbered text, not the raw body', async () => {
    const client = new BaileysClient(wpClient)
    await client.initialize()

    const socketCalls = (makeWASocket as jest.Mock).mock.results
    const sock = socketCalls[socketCalls.length - 1].value
    sock.sendMessage.mockResolvedValueOnce({
      key: { remoteJid: '573001234567@s.whatsapp.net', id: 'WAMID-BTN' },
      message: { conversation: 'rendered' },
    })

    const addWorkerMock = (QueueService.getInstance() as any).addWorker as jest.Mock
    const workerCalls = addWorkerMock.mock.calls
    const worker = workerCalls[workerCalls.length - 1][1] as (data: any) => Promise<void>

    await worker({
      phoneNumber: '573001234567@s.whatsapp.net',
      message: {
        id: 'msg-1',
        name: 'test',
        description: 'test',
        message: 'Seguimos buscando conductor.',
        enabled: true,
        interactive: {
          type: 'button',
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'CANCEL', title: 'Cancelar' } },
              { type: 'reply', reply: { id: 'INSIST', title: 'Insistir' } },
            ],
          },
        },
      },
    })

    expect(sock.sendMessage).toHaveBeenCalledWith('573001234567@s.whatsapp.net', {
      text: 'Seguimos buscando conductor.\n\n1. Cancelar\n2. Insistir',
    })
  })
})

describe('BaileysClient reconnect policy (spec: wp-baileys-transport - Reconnect policy and credential retention)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function latestSocket(): any {
    const results = (makeWASocket as jest.Mock).mock.results
    return results[results.length - 1].value
  }

  function connectionUpdateHandler(sock: any): (update: any) => void {
    const call = sock.ev.on.mock.calls.find(([event]: [string]) => event === 'connection.update')
    return call[1]
  }

  function closeUpdate(statusCode: number) {
    return { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } }
  }

  const NON_LOGOUT_STATUS_CODE = DisconnectReason.connectionLost

  it('keeps retrying five non-logout closes in a row with growing backoff, never deleting the session folder', async () => {
    const client = new BaileysClient(wpClient)
    const scheduleSpy = jest.spyOn(client as any, 'scheduleReconnect')

    await client.initialize()
    let handler = connectionUpdateHandler(latestSocket())

    const expectedDelays = [3000, 6000, 12000, 24000, 48000]
    for (const expectedDelay of expectedDelays) {
      handler(closeUpdate(NON_LOGOUT_STATUS_CODE))
      expect(scheduleSpy).toHaveBeenLastCalledWith(expectedDelay)

      await jest.advanceTimersByTimeAsync(expectedDelay)
      handler = connectionUpdateHandler(latestSocket())
    }

    // A sixth failure would exceed the 60s cap (3000 * 2^5 = 96000) and must clamp to it.
    handler(closeUpdate(NON_LOGOUT_STATUS_CODE))
    expect(scheduleSpy).toHaveBeenLastCalledWith(60000)

    expect(makeWASocket).toHaveBeenCalledTimes(expectedDelays.length + 1)
    expect(FileHelper.removeFolder).not.toHaveBeenCalled()
  })

  it('deletes the session folder and does not reconnect on a loggedOut close', async () => {
    const client = new BaileysClient(wpClient)
    const disconnectedListener = jest.fn()
    client.on(WpEvents.DISCONNECTED, disconnectedListener)
    const scheduleSpy = jest.spyOn(client as any, 'scheduleReconnect')

    await client.initialize()
    const handler = connectionUpdateHandler(latestSocket())
    const makeWASocketCallsBefore = (makeWASocket as jest.Mock).mock.calls.length

    handler(closeUpdate(DisconnectReason.loggedOut))

    expect(FileHelper.removeFolder).toHaveBeenCalledWith(BaileysClient.SESSION_PATH + wpClient.id)
    expect(disconnectedListener).toHaveBeenCalledTimes(1)
    expect(scheduleSpy).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(120000)
    expect(makeWASocket).toHaveBeenCalledTimes(makeWASocketCallsBefore)
  })

  it('resets the attempt counter after the connection reaches open', async () => {
    const client = new BaileysClient(wpClient)
    const scheduleSpy = jest.spyOn(client as any, 'scheduleReconnect')

    await client.initialize()
    let handler = connectionUpdateHandler(latestSocket())

    handler(closeUpdate(NON_LOGOUT_STATUS_CODE))
    expect(scheduleSpy).toHaveBeenLastCalledWith(3000)

    await jest.advanceTimersByTimeAsync(3000)
    handler = connectionUpdateHandler(latestSocket())

    handler({ connection: 'open' })
    handler(closeUpdate(NON_LOGOUT_STATUS_CODE))

    expect(scheduleSpy).toHaveBeenLastCalledWith(3000)
  })

  it('reconnects immediately on a restartRequired close, without waiting for backoff', async () => {
    const client = new BaileysClient(wpClient)
    const scheduleSpy = jest.spyOn(client as any, 'scheduleReconnect')

    await client.initialize()
    const handler = connectionUpdateHandler(latestSocket())

    handler(closeUpdate(DisconnectReason.restartRequired))
    expect(scheduleSpy).toHaveBeenLastCalledWith(0)
    expect(FileHelper.removeFolder).not.toHaveBeenCalled()

    const makeWASocketCallsBefore = (makeWASocket as jest.Mock).mock.calls.length
    await jest.advanceTimersByTimeAsync(0)
    expect(makeWASocket).toHaveBeenCalledTimes(makeWASocketCallsBefore + 1)
  })
})

describe('BaileysClient phone-number resolution (spec: wp-baileys-transport - Phone-number resolution for inbound messages)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function latestSocket(): any {
    const results = (makeWASocket as jest.Mock).mock.results
    return results[results.length - 1].value
  }

  function messagesUpsertHandler(sock: any): (payload: any) => Promise<void> {
    const call = sock.ev.on.mock.calls.find(([event]: [string]) => event === 'messages.upsert')
    return call[1]
  }

  function waMessage(key: Record<string, unknown>, id: string) {
    return {
      messages: [
        {
          key: { fromMe: false, id, ...key },
          message: { conversation: 'hello' },
          messageTimestamp: 1_700_000_000,
        },
      ],
      type: 'notify',
    }
  }

  it('Chat addressed by phone number: resolves from remoteJid', async () => {
    const client = new BaileysClient(wpClient)
    const received = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, received)

    await client.initialize()
    const handler = messagesUpsertHandler(latestSocket())

    await handler(waMessage({ remoteJid: '573001234567@s.whatsapp.net' }, 'MSG-PN'))

    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].from).toBe('573001234567@c.us')
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).not.toHaveBeenCalled()
  })

  it('Chat addressed by LID with an alternate phone number: resolves from remoteJidAlt', async () => {
    const client = new BaileysClient(wpClient)
    const received = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, received)

    await client.initialize()
    const sock = latestSocket()
    const handler = messagesUpsertHandler(sock)

    await handler(
      waMessage(
        {
          remoteJid: '12345678901234@lid',
          remoteJidAlt: '573001234567@s.whatsapp.net',
        },
        'MSG-LID-ALT'
      )
    )

    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].from).toBe('573001234567@c.us')
    expect(sock.signalRepository.lidMapping.getPNForLID).not.toHaveBeenCalled()
  })

  it('LID resolved through the mapping store: resolves via getPNForLID when there is no alt', async () => {
    const client = new BaileysClient(wpClient)
    const received = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, received)

    await client.initialize()
    const sock = latestSocket()
    sock.signalRepository.lidMapping.getPNForLID.mockResolvedValueOnce(
      '573009999999@s.whatsapp.net'
    )
    const handler = messagesUpsertHandler(sock)

    await handler(waMessage({ remoteJid: '12345678901234@lid' }, 'MSG-LID-MAPPED'))

    expect(sock.signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith('12345678901234@lid')
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].from).toBe('573009999999@c.us')
  })

  it('Unresolvable LID is skipped, not thrown: logs a warning, records the audit row, and keeps processing later messages', async () => {
    const client = new BaileysClient(wpClient)
    const received = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, received)

    await client.initialize()
    const sock = latestSocket()
    const warnSpy = jest.spyOn((client as any).logger, 'warn')
    sock.signalRepository.lidMapping.getPNForLID.mockResolvedValueOnce(null)

    const handler = messagesUpsertHandler(sock)

    await handler(waMessage({ remoteJid: '12345678901234@lid' }, 'MSG-UNRESOLVED'))

    expect(received).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      {
        wpClientId: wpClient.id,
        messageId: 'MSG-UNRESOLVED',
        remoteJid: '12345678901234@lid',
      },
      expect.any(String)
    )
    expect(IgnoredInboundMessageAuditRepository.recordIgnoredEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        wpClientId: wpClient.id,
        messageId: 'MSG-UNRESOLVED',
        chatId: '12345678901234@lid',
        reason: 'unresolved_sender',
      })
    )

    // The transport keeps processing later messages after an unresolved sender.
    await handler(waMessage({ remoteJid: '573001234567@s.whatsapp.net' }, 'MSG-AFTER'))
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].from).toBe('573001234567@c.us')
  })
})
