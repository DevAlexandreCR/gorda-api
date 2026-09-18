jest.mock('axios')

import axios, { AxiosError } from 'axios'
import {
  OpenAIResponsesClient,
  OpenAIResponsesError,
  OpenAIResponsesParseError,
  OpenAIResponsesRequest,
  ResponsesRawItem,
} from '../OpenAIResponsesClient'

const mockedAxios = axios as jest.Mocked<typeof axios>

function axiosErrorWithStatus(
  status: number,
  data: unknown = { error: { message: 'error' } }
): AxiosError {
  const error = new Error(`Request failed with status code ${status}`) as AxiosError
  error.isAxiosError = true
  error.response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: {} as never,
  } as never
  return error
}

function networkError(): AxiosError {
  const error = new Error('timeout of 30000ms exceeded') as AxiosError
  error.isAxiosError = true
  return error
}

function messageOutput(payload: unknown): ResponsesRawItem[] {
  return [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(payload), annotations: [] }],
    },
  ]
}

function functionCallOutput(
  callId: string,
  name: string,
  args: Record<string, unknown>
): ResponsesRawItem[] {
  return [
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: 'completed',
    },
  ]
}

const baseRequest: OpenAIResponsesRequest = {
  input: [{ role: 'user', content: 'hola' }],
  instructions: 'static instructions',
  textFormat: { name: 'agent_turn', schema: { type: 'object' } },
}

describe('OpenAIResponsesClient (spec: chatbot-agent-conversation, task 2.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('throws immediately when no API key is configured', async () => {
    const client = new OpenAIResponsesClient({ apiKey: '' })
    await expect(client.createResponse(baseRequest)).rejects.toBeInstanceOf(OpenAIResponsesError)
    expect(mockedAxios.post).not.toHaveBeenCalled()
  })

  it('returns the final parsed JSON on a plain success', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post.mockResolvedValueOnce({
      data: { output: messageOutput({ reply: 'Hola, ¿en qué te ayudo?', actions: [] }) },
    })

    const result = await client.createResponse(baseRequest)

    expect(result.type).toBe('final')
    if (result.type === 'final') {
      expect(result.data).toEqual({ reply: 'Hola, ¿en qué te ayudo?', actions: [] })
    }
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
    const [url, payload, options] = mockedAxios.post.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(payload).toMatchObject({
      model: 'gpt-5.6-luna',
      instructions: 'static instructions',
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'agent_turn',
          strict: true,
          schema: { type: 'object' },
        },
      },
      reasoning: { effort: 'none' },
      store: false,
    })
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer sk-test' } })
  })

  it('does a full tool-call round trip: function_call -> function_call_output -> final', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    const rawFunctionCall = functionCallOutput('call_abc123', 'search_place', {
      query: 'campanario',
    })

    mockedAxios.post
      .mockResolvedValueOnce({ data: { output: rawFunctionCall } })
      .mockResolvedValueOnce({ data: { output: messageOutput({ reply: 'Listo', actions: [] }) } })

    const firstRequest: OpenAIResponsesRequest = {
      ...baseRequest,
      tools: [
        {
          type: 'function',
          name: 'search_place',
          description: 'Search a place',
          parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
          strict: true,
        },
      ],
    }

    const firstResult = await client.createResponse(firstRequest)
    expect(firstResult.type).toBe('function_calls')
    if (firstResult.type !== 'function_calls') throw new Error('expected function_calls')
    expect(firstResult.calls).toEqual([
      { callId: 'call_abc123', name: 'search_place', arguments: { query: 'campanario' } },
    ])

    const followUpInput = client.buildFollowUpInput(firstRequest.input, firstResult.rawOutput, [
      {
        callId: 'call_abc123',
        output: JSON.stringify({ candidates: [], hasStrongCandidate: false }),
      },
    ])

    expect(followUpInput).toEqual([
      ...firstRequest.input,
      ...rawFunctionCall,
      {
        type: 'function_call_output',
        call_id: 'call_abc123',
        output: JSON.stringify({ candidates: [], hasStrongCandidate: false }),
      },
    ])

    const secondResult = await client.createResponse({
      ...firstRequest,
      input: followUpInput,
      toolChoice: 'none',
    })
    expect(secondResult.type).toBe('final')
    if (secondResult.type === 'final') {
      expect(secondResult.data).toEqual({ reply: 'Listo', actions: [] })
    }

    const secondPayload = mockedAxios.post.mock.calls[1][1] as Record<string, unknown>
    expect(secondPayload.tool_choice).toBe('none')
    expect(secondPayload.input).toEqual(followUpInput)
  })

  it('retries once on 429 then succeeds', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post
      .mockRejectedValueOnce(axiosErrorWithStatus(429))
      .mockResolvedValueOnce({ data: { output: messageOutput({ reply: 'ok', actions: [] }) } })

    const promise = client.createResponse(baseRequest)
    await jest.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(result.type).toBe('final')
    expect(mockedAxios.post).toHaveBeenCalledTimes(2)
  })

  it('retries once on 500 then succeeds', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post
      .mockRejectedValueOnce(axiosErrorWithStatus(500))
      .mockResolvedValueOnce({ data: { output: messageOutput({ reply: 'ok', actions: [] }) } })

    const promise = client.createResponse(baseRequest)
    await jest.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(result.type).toBe('final')
    expect(mockedAxios.post).toHaveBeenCalledTimes(2)
  })

  it('retries a 401 then succeeds', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post
      .mockRejectedValueOnce(axiosErrorWithStatus(401))
      .mockResolvedValueOnce({ data: { output: messageOutput({ reply: 'ok', actions: [] }) } })

    const promise = client.createResponse(baseRequest)
    await jest.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(result.type).toBe('final')
    expect(mockedAxios.post).toHaveBeenCalledTimes(2)
  })

  it('retries a 408 up to the attempt bound and then surfaces the failure', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post
      .mockRejectedValueOnce(axiosErrorWithStatus(408))
      .mockRejectedValueOnce(axiosErrorWithStatus(408))
      .mockRejectedValueOnce(axiosErrorWithStatus(408))

    const promise = client.createResponse(baseRequest)
    // Attach the rejection assertion before advancing timers so the promise
    // never rejects unobserved (would otherwise race jest's unhandled-rejection check).
    const assertion = expect(promise).rejects.toMatchObject({ status: 408 })
    // Let both backoff windows (500ms, 1500ms) elapse.
    await jest.advanceTimersByTimeAsync(3000)
    await assertion
    expect(mockedAxios.post).toHaveBeenCalledTimes(3)
  })

  it('surfaces a non-retryable 400 immediately without retrying, redacting the API key in the logged error', async () => {
    const secretKey = 'sk-test-secret-1234'
    const client = new OpenAIResponsesClient({ apiKey: secretKey })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    mockedAxios.post.mockRejectedValueOnce(
      axiosErrorWithStatus(400, {
        error: { message: `Invalid Authorization: Bearer ${secretKey}` },
      })
    )

    await expect(client.createResponse(baseRequest)).rejects.toMatchObject({ status: 400 })
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)

    const loggedPayload = errorSpy.mock.calls.map((call) => call[0]).join('\n')
    expect(loggedPayload).not.toContain(secretKey)
    expect(loggedPayload).toContain('sk-***')

    errorSpy.mockRestore()
  })

  it('does not retry a network/timeout error with no HTTP response', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post.mockRejectedValueOnce(networkError())

    await expect(client.createResponse(baseRequest)).rejects.toBeInstanceOf(OpenAIResponsesError)
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  it('rejects an unparsable final output with a typed parse error', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'not json at all', annotations: [] }],
          },
        ],
      },
    })

    await expect(client.createResponse(baseRequest)).rejects.toBeInstanceOf(
      OpenAIResponsesParseError
    )
  })

  it('rejects a response with neither function calls nor output text', async () => {
    const client = new OpenAIResponsesClient({ apiKey: 'sk-test' })
    mockedAxios.post.mockResolvedValueOnce({ data: { output: [] } })

    await expect(client.createResponse(baseRequest)).rejects.toBeInstanceOf(
      OpenAIResponsesParseError
    )
  })
})
