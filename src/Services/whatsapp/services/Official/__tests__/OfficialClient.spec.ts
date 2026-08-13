jest.mock('axios')

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

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

jest.mock('../../../../store/Store', () => ({
  Store: {
    getInstance: jest.fn().mockReturnValue({
      getChats: jest.fn(),
      findClientById: jest.fn(),
      getChatById: jest.fn(),
    }),
  },
}))

import axios from 'axios'
import * as Sentry from '@sentry/node'
import { OfficialClient } from '../OfficialClient'
import { WpClient } from '../../../../../Interfaces/WpClient'
import { WpClients } from '../../../constants/WPClients'
import { WpEvents } from '../../../constants/WpEvents'
import config from '../../../../../../config'

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedSentry = Sentry as jest.Mocked<typeof Sentry>

const wpClient: WpClient = {
  id: 'wp-client-1',
  alias: 'Test Client',
  wpNotifications: false,
  full: false,
  chatBot: true,
  assistant: false,
  service: WpClients.OFFICIAL,
}

describe('OfficialClient.sendTypingIndicator (spec: chatbot-typing-indicator)', () => {
  let client: OfficialClient

  beforeEach(() => {
    jest.clearAllMocks()
    client = new OfficialClient(wpClient)
  })

  it('POSTs the exact official payload shape to the client message URL with a 3s timeout', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} })

    await client.sendTypingIndicator('573001234567@c.us', 'wamid.HBgMOTI=')

    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
    const [url, data, options] = mockedAxios.post.mock.calls[0]

    expect(url).toBe(config.WAPI_URL + wpClient.id + '/messages')
    expect(data).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.HBgMOTI=',
      typing_indicator: { type: 'text' },
    })
    expect(options).toMatchObject({ timeout: 3000 })
  })

  it('swallows a WAPI rejection: logs via console.warn and resolves without throwing', async () => {
    const error = { response: { data: { error: { message: 'bad request' } } } }
    mockedAxios.post.mockRejectedValue(error)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      client.sendTypingIndicator('573001234567@c.us', 'wamid.HBgMOTI=')
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith('Failed to send typing indicator:', error.response.data)

    warnSpy.mockRestore()
  })

  it('swallows a timeout (no response) via the error message branch', async () => {
    const error = { message: 'timeout of 3000ms exceeded' }
    mockedAxios.post.mockRejectedValue(error)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      client.sendTypingIndicator('573001234567@c.us', 'wamid.HBgMOTI=')
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith('Failed to send typing indicator:', error.message)

    warnSpy.mockRestore()
  })
})

describe('OfficialClient.on / removeAllListeners (spec: wp-inbound-single-processing, task 1.4)', () => {
  let client: OfficialClient

  beforeEach(() => {
    jest.clearAllMocks()
    client = new OfficialClient(wpClient)
  })

  it('removeAllListeners() detaches previously registered callbacks', () => {
    const callback = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, callback)

    client.removeAllListeners()
    client.triggerEvent(WpEvents.MESSAGE_RECEIVED, 'some-arg')

    expect(callback).not.toHaveBeenCalled()
  })

  it('registers a single callback normally: triggerEvent invokes it exactly once', () => {
    const callback = jest.fn()
    client.on(WpEvents.MESSAGE_RECEIVED, callback)

    client.triggerEvent(WpEvents.MESSAGE_RECEIVED, 'some-arg')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('some-arg')
  })

  it('logs a warning (and reports to Sentry) when a second callback is registered for the same event, while still registering both', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const firstCallback = jest.fn()
    const secondCallback = jest.fn()

    client.on(WpEvents.MESSAGE_RECEIVED, firstCallback)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(mockedSentry.captureMessage).not.toHaveBeenCalled()

    client.on(WpEvents.MESSAGE_RECEIVED, secondCallback)

    expect(warnSpy).toHaveBeenCalledWith(
      '[OfficialClientDuplicateListener]',
      expect.stringContaining(wpClient.id)
    )
    expect(mockedSentry.captureMessage).toHaveBeenCalledWith(
      'OfficialClient: duplicate event registration',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({
          wpClientId: wpClient.id,
          event: WpEvents.MESSAGE_RECEIVED,
          callbackCount: 2,
        }),
      })
    )

    // Registration behavior is unchanged: both callbacks remain registered and fire.
    client.triggerEvent(WpEvents.MESSAGE_RECEIVED, 'payload')
    expect(firstCallback).toHaveBeenCalledWith('payload')
    expect(secondCallback).toHaveBeenCalledWith('payload')

    warnSpy.mockRestore()
  })
})
