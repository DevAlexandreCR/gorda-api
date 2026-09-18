import axios, { AxiosError } from 'axios'
import config from '../../../../config'

// Design D1/D2 (agent-first-chatbot): the agent module calls the OpenAI
// Responses API directly from `api` over axios — no SDK, no `ia-app` hop.
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const REQUEST_TIMEOUT_MS = 30000

// Incident precedent (LiBi's openaiClient.ts): a transient 401 can occur with
// the same key that succeeds seconds later. Only retry errors that are
// plausibly transient on OpenAI's side; a non-retryable 4xx or a network/
// timeout error (no response at all) will not succeed on retry.
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 1500]
const MAX_RETRY_AFTER_MS = 5000

export type ResponsesRole = 'user' | 'assistant' | 'developer' | 'system'

export type ResponsesMessageItem = {
  role: ResponsesRole
  content: string
}

export type ResponsesFunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

// Any other item the Responses API accepts as input (function_call, reasoning,
// message with structured content, etc). These are only ever round-tripped
// verbatim from a previous response's `output` array (see buildFollowUpInput),
// never constructed by hand, so a loose shape is enough here.
export type ResponsesRawItem = Record<string, unknown> & { type: string }

export type ResponsesInputItem =
  ResponsesMessageItem | ResponsesFunctionCallOutputItem | ResponsesRawItem

export type FunctionToolDefinition = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: true
}

export type ToolChoice = 'auto' | 'none'

export type JsonSchemaFormat = {
  name: string
  schema: Record<string, unknown>
}

export type OpenAIResponsesRequest = {
  input: ResponsesInputItem[]
  // Static across calls for a given prompt version so OpenAI can cache it (design D2).
  instructions: string
  tools?: FunctionToolDefinition[]
  toolChoice?: ToolChoice
  textFormat: JsonSchemaFormat
  model?: string
  reasoningEffort?: string
}

export type FunctionCallRequest = {
  callId: string
  name: string
  arguments: unknown
}

// The output array of a Responses API call, kept raw so buildFollowUpInput can
// replay it (message/function_call/reasoning items) without this client having
// to model every item shape the API may return.
export type OpenAIResponsesResult<T = unknown> =
  | { type: 'function_calls'; calls: FunctionCallRequest[]; rawOutput: ResponsesRawItem[] }
  | { type: 'final'; data: T; rawOutput: ResponsesRawItem[] }

export class OpenAIResponsesError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'OpenAIResponsesError'
  }
}

export class OpenAIResponsesParseError extends Error {
  constructor(
    message: string,
    public readonly rawText?: string
  ) {
    super(message)
    this.name = 'OpenAIResponsesParseError'
  }
}

export type OpenAIResponsesClientOptions = {
  apiKey?: string
  model?: string
  reasoningEffort?: string
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryAfterMs(err: AxiosError): number | null {
  const header = err.response?.headers?.['retry-after']
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isFinite(seconds)) return null
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

/**
 * Stateless-per-request client for the OpenAI Responses API (design D1/D2).
 * One call = one HTTP request with retries; the tool-calling loop itself is
 * owned by `AgentTurn` (task 2.8), which uses `buildFollowUpInput` to carry
 * function_call_output items into the next call.
 */
export class OpenAIResponsesClient {
  private readonly apiKey: string
  private readonly defaultModel: string
  private readonly defaultReasoningEffort: string

  constructor(options: OpenAIResponsesClientOptions = {}) {
    this.apiKey = options.apiKey ?? config.OPENAI_API_KEY
    this.defaultModel = options.model ?? config.OPENAI_MODEL
    this.defaultReasoningEffort = options.reasoningEffort ?? config.OPENAI_REASONING_EFFORT
  }

  public async createResponse<T = unknown>(
    request: OpenAIResponsesRequest
  ): Promise<OpenAIResponsesResult<T>> {
    if (!this.apiKey) {
      throw new OpenAIResponsesError('OPENAI_API_KEY is not configured')
    }

    const payload = this.buildPayload(request)
    const data = await this.postWithRetry(payload)
    return this.parseOutput<T>(data, request.textFormat.name)
  }

  /**
   * Builds the `input` for the follow-up call after a `function_calls` result:
   * the previous input, the model's raw output items (function_call and any
   * accompanying items) replayed verbatim, then one function_call_output per
   * executed tool call. Pure — no state is kept on the client between calls.
   */
  public buildFollowUpInput(
    previousInput: ResponsesInputItem[],
    rawOutput: ResponsesRawItem[],
    functionOutputs: Array<{ callId: string; output: string }>
  ): ResponsesInputItem[] {
    const functionCallOutputItems: ResponsesFunctionCallOutputItem[] = functionOutputs.map((f) => ({
      type: 'function_call_output',
      call_id: f.callId,
      output: f.output,
    }))

    return [...previousInput, ...rawOutput, ...functionCallOutputItems]
  }

  private buildPayload(request: OpenAIResponsesRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      instructions: request.instructions,
      input: request.input,
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: request.textFormat.name,
          strict: true,
          schema: request.textFormat.schema,
        },
      },
      reasoning: { effort: request.reasoningEffort || this.defaultReasoningEffort },
      store: false,
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools
    }

    // Forced finalize (design D2) sends tool_choice: 'none' while `tools` may
    // still be declared; only default to 'auto' when the caller left it unset.
    if (request.toolChoice) {
      payload.tool_choice = request.toolChoice
    } else if (request.tools && request.tools.length > 0) {
      payload.tool_choice = 'auto'
    }

    return payload
  }

  private async postWithRetry(payload: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(OPENAI_RESPONSES_URL, payload, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeout: REQUEST_TIMEOUT_MS,
        })
        return response.data
      } catch (err) {
        const axiosErr = err as AxiosError
        const status = axiosErr.response?.status
        const retryable = status !== undefined && isRetryableStatus(status)
        const isLastAttempt = attempt === MAX_ATTEMPTS

        if (!retryable || isLastAttempt) {
          this.logFailure(attempt, status, axiosErr)
          throw new OpenAIResponsesError(
            `OpenAI Responses API call failed${status ? ` with status ${status}` : ''}`,
            status,
            this.safeCause(status, axiosErr)
          )
        }

        this.logRetry(attempt, status, axiosErr)

        // No jitter: bounded to 3 attempts, so the added complexity of
        // jittering backoff isn't worth it just to avoid retry collisions.
        const delay =
          status === 429
            ? (retryAfterMs(axiosErr) ?? BACKOFF_MS[attempt - 1])
            : BACKOFF_MS[attempt - 1]
        await sleep(delay)
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new OpenAIResponsesError('OpenAI Responses API call failed after retries')
  }

  private parseOutput<T>(data: unknown, schemaName: string): OpenAIResponsesResult<T> {
    const output: ResponsesRawItem[] = Array.isArray((data as { output?: unknown })?.output)
      ? ((data as { output: ResponsesRawItem[] }).output as ResponsesRawItem[])
      : []

    const functionCalls = output.filter((item) => item.type === 'function_call')
    if (functionCalls.length > 0) {
      const calls: FunctionCallRequest[] = functionCalls.map((item) => ({
        callId: String(item.call_id),
        name: String(item.name),
        arguments: this.parseArguments(item.arguments),
      }))
      return { type: 'function_calls', calls, rawOutput: output }
    }

    const text = this.extractOutputText(output)
    if (text === null) {
      throw new OpenAIResponsesParseError(
        `OpenAI response for schema "${schemaName}" contained no function calls and no output text`
      )
    }

    let parsed: T
    try {
      parsed = JSON.parse(text) as T
    } catch (e) {
      throw new OpenAIResponsesParseError(
        `Unable to parse final output as JSON for schema "${schemaName}"`,
        text
      )
    }

    return { type: 'final', data: parsed, rawOutput: output }
  }

  private parseArguments(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  private extractOutputText(output: ResponsesRawItem[]): string | null {
    const parts: string[] = []
    for (const item of output) {
      if (item.type !== 'message') continue
      const content = Array.isArray(item.content) ? item.content : []
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'output_text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          parts.push((part as { text: string }).text)
        }
      }
    }
    return parts.length > 0 ? parts.join('') : null
  }

  // Stringify + redact rather than mutate in place, so a nested key never
  // hides the secret from the redaction pass.
  private redact(value: unknown): string | undefined {
    if (value === undefined) return undefined
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    const keyRedacted = this.apiKey ? str.split(this.apiKey).join('sk-***') : str
    return keyRedacted.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
  }

  // Only the redacted status/body/message ever leave this method — never the
  // AxiosError itself, whose `.config` carries the Authorization header.
  private safeCause(status: number | undefined, err: AxiosError): unknown {
    return { status, data: this.redact(err.response?.data), message: err.message }
  }

  private logFailure(attempt: number, status: number | undefined, err: AxiosError): void {
    console.error(
      JSON.stringify({
        event: 'openai_responses_call_failed',
        attempts: attempt,
        status,
        data: this.redact(err.response?.data),
        message: err.message,
      })
    )
  }

  private logRetry(attempt: number, status: number | undefined, err: AxiosError): void {
    console.warn(
      JSON.stringify({
        event: 'openai_responses_call_retry',
        attempt,
        status,
        data: this.redact(err.response?.data),
      })
    )
  }
}
