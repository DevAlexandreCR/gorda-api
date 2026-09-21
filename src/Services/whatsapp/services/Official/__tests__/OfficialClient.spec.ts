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

jest.mock('../../../../../Repositories/MessageRepository', () => ({
  __esModule: true,
  default: {
    addMessage: jest.fn(),
  },
}))

import axios from 'axios'
import * as Sentry from '@sentry/node'
import { OfficialClient } from '../OfficialClient'
import { WpClient } from '../../../../../Interfaces/WpClient'
import { WpClients } from '../../../constants/WPClients'
import { WpEvents } from '../../../constants/WpEvents'
import config from '../../../../../../config'
import { Store } from '../../../../store/Store'
import MessageRepository from '../../../../../Repositories/MessageRepository'
import { sanitizeInteractiveForOfficial } from '../Constants/InteractiveLimits'
import { Interactive } from '../Constants/Interactive'
import { ChatBotMessage } from '../../../../../Types/ChatBotMessage'

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedSentry = Sentry as jest.Mocked<typeof Sentry>

const wpClient: WpClient = {
  id: 'wp-client-1',
  alias: 'Test Client',
  wpNotifications: false,
  full: false,
  chatBot: true,
  assistant: false,
  agentInTrip: false,
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

function buildMessage(interactive: Interactive | null): ChatBotMessage {
  return {
    id: 'msg-1',
    name: 'catalog',
    description: 'test message',
    message: 'body text',
    enabled: true,
    interactive,
  }
}

describe('sanitizeInteractiveForOfficial (spec: official-interactive-length-limits)', () => {
  it('truncates an over-limit list row title with a single ellipsis, leaving description untouched', () => {
    const interactive: Interactive = {
      type: 'list',
      action: {
        button: 'Ver opciones',
        sections: [
          {
            title: 'Resultados',
            rows: [
              {
                id: 'row-1',
                title: 'Campanario Centro Comercial',
                description: 'Bogotá, Colombia',
              },
            ],
          },
        ],
      },
    }

    const sanitized = sanitizeInteractiveForOfficial(interactive)
    const row = sanitized.action.sections![0].rows[0]

    expect(row.title).toBe('Campanario Centro Comer…')
    expect(row.title.length).toBe(24)
    expect(row.description).toBe('Bogotá, Colombia')
  })

  it('truncates action.button, section title, reply.title, header, footer and body when they exceed their limits', () => {
    const interactive: Interactive = {
      type: 'button',
      body: { text: 'x'.repeat(1030) },
      header: { type: 'text', text: 'x'.repeat(65) },
      footer: { text: 'x'.repeat(65) },
      action: {
        button: 'Abrir lista de opciones aquí',
        sections: [
          { title: 'Una sección con un título largo', rows: [{ id: 'r1', title: 'ok' }] },
        ],
        buttons: [{ type: 'reply', reply: { id: 'b1', title: 'Una etiqueta muy larga' } }],
      },
    }

    const sanitized = sanitizeInteractiveForOfficial(interactive)

    expect(sanitized.body!.text.length).toBe(1024)
    expect(sanitized.body!.text.endsWith('…')).toBe(true)
    expect(sanitized.header!.text.length).toBe(60)
    expect(sanitized.footer!.text.length).toBe(60)
    expect(sanitized.action.button!.length).toBe(20)
    expect(sanitized.action.sections![0].title!.length).toBe(24)
    expect(sanitized.action.buttons![0].reply!.title.length).toBe(20)
  })

  it('returns a value unchanged (deep-equal) when every field is already inside its limit', () => {
    const interactive: Interactive = {
      type: 'list',
      body: { text: 'Elige una opción' },
      header: { type: 'text', text: 'Encabezado' },
      footer: { text: 'Pie de página' },
      action: {
        button: 'Abrir',
        sections: [
          {
            title: 'Sección',
            rows: [{ id: 'row-1', title: 'Opción corta', description: 'Descripción corta' }],
          },
        ],
        buttons: [{ type: 'reply', reply: { id: 'b1', title: 'Sí' } }],
      },
    }

    const sanitized = sanitizeInteractiveForOfficial(interactive)

    expect(sanitized).toEqual(interactive)
  })

  it('does not mutate the original interactive object', () => {
    const interactive: Interactive = {
      type: 'list',
      action: {
        button: 'Ver opciones',
        sections: [
          {
            title: 'Resultados',
            rows: [{ id: 'row-1', title: 'Campanario Centro Comercial' }],
          },
        ],
      },
    }
    const snapshot = JSON.parse(JSON.stringify(interactive))

    sanitizeInteractiveForOfficial(interactive)

    expect(interactive).toEqual(snapshot)
  })

  it('passes a location_request_message through unchanged', () => {
    const interactive: Interactive = {
      type: 'location_request_message',
      body: { text: 'Comparte tu ubicación' },
      action: { name: 'send_location' },
    }

    const sanitized = sanitizeInteractiveForOfficial(interactive)

    expect(sanitized).toEqual(interactive)
  })
})

describe('OfficialClient.text interactive sanitization (spec: official-interactive-length-limits)', () => {
  let client: OfficialClient
  const mockedStore = Store.getInstance() as unknown as {
    findClientById: jest.Mock
    getChatById: jest.Mock
  }
  const mockedMessageRepository = MessageRepository as jest.Mocked<typeof MessageRepository>

  beforeEach(() => {
    jest.clearAllMocks()
    client = new OfficialClient(wpClient)
    mockedStore.findClientById.mockReturnValue(undefined)
    mockedStore.getChatById.mockResolvedValue({ id: 'chat-1' })
    mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } })
  })

  it('sends the sanitized interactive to the Cloud API and persists it, without mutating message.interactive', async () => {
    const interactive: Interactive = {
      type: 'list',
      action: {
        button: 'Ver opciones',
        sections: [
          {
            title: 'Resultados',
            rows: [{ id: 'row-1', title: 'Campanario Centro Comercial' }],
          },
        ],
      },
    }
    const originalSnapshot = JSON.parse(JSON.stringify(interactive))
    const message = buildMessage(interactive)

    await client.text('573001234567@c.us', message)

    const [, postedData] = mockedAxios.post.mock.calls[0]
    const sentInteractive = (postedData as unknown as { interactive: Interactive }).interactive
    expect(sentInteractive.action.sections![0].rows[0].title).toBe('Campanario Centro Comer…')
    expect(mockedMessageRepository.addMessage).toHaveBeenCalledWith(
      wpClient.id,
      'chat-1',
      expect.objectContaining({
        interactive: expect.objectContaining({
          action: expect.objectContaining({
            sections: [
              expect.objectContaining({
                rows: [expect.objectContaining({ title: 'Campanario Centro Comer…' })],
              }),
            ],
          }),
        }),
      })
    )
    expect(message.interactive).toEqual(originalSnapshot)
  })
})
