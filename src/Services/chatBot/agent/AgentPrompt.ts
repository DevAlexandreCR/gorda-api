import * as fs from 'fs'
import * as path from 'path'
import { JsonSchemaFormat } from './OpenAIResponsesClient'

// Design D1 (agent-first-chatbot): tsc does not copy .md files, so `build`
// gets a `cp -r` step (package.json) mirroring `prompts/` under
// `build/src/Services/chatBot/agent/prompts/`, the same way tsc mirrors the
// rest of `src/` under `build/src/`. Resolving relative to `__dirname` here
// (rather than a path rooted at `src/`) is what makes this file work
// unmodified whether it runs from `src/` (ts-node/nodemon/jest) or from
// `build/src/` (the compiled output) — `__dirname` always sits next to
// `prompts/` in whichever tree it was loaded from.
const PROMPT_FILE_PATH = path.join(__dirname, 'prompts', 'agent.md')

// Loaded once and cached at module scope (task 2.2: "it loads once at
// startup"); every caller within the process shares this same string.
let cachedPrompt: string | null = null

/**
 * Static agent instructions sent as the OpenAI Responses API `instructions`
 * parameter (design D2). Read from disk once; subsequent calls return the
 * cached value with no further I/O.
 */
export function getAgentPrompt(): string {
  if (cachedPrompt === null) {
    cachedPrompt = fs.readFileSync(PROMPT_FILE_PATH, 'utf8')
  }
  return cachedPrompt
}

// Action vocabulary (chatbot-agent-conversation spec, "Action vocabulary and
// deterministic validation"). Consumed by AgentValidator/AgentExecutor
// (tasks 2.5/2.7).
export type AgentAction =
  | { type: 'set_client_name'; name: string }
  | { type: 'set_place'; placeId: string }
  | { type: 'set_place_from_location'; reference: string }
  | { type: 'set_comment'; text: string }
  | { type: 'create_service' }
  | { type: 'cancel_service' }
  | { type: 'insist_service' }
  | { type: 'escalate_support' }

export type AgentActionType = AgentAction['type']

export interface AgentOutput {
  reply: string
  actions: AgentAction[]
}

// Strict json_schema shape for the final model output (design D2): every
// action variant is a closed object (`additionalProperties: false`, every
// key required) discriminated by `type`; the union itself is `anyOf` per
// OpenAI's structured-outputs support for discriminated unions. `enum` (not
// `const`) is used for the discriminator to match the pattern already
// established by the retired ia-app schema (`intent`).
function actionVariant(
  type: AgentActionType,
  argProperties: Record<string, unknown> = {}
): Record<string, unknown> {
  const argNames = Object.keys(argProperties)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', ...argNames],
    properties: {
      type: { type: 'string', enum: [type] },
      ...argProperties,
    },
  }
}

export const AGENT_OUTPUT_JSON_SCHEMA: JsonSchemaFormat = {
  name: 'agent_output',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'actions'],
    properties: {
      reply: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          anyOf: [
            actionVariant('set_client_name', { name: { type: 'string' } }),
            actionVariant('set_place', { placeId: { type: 'string' } }),
            actionVariant('set_place_from_location', { reference: { type: 'string' } }),
            actionVariant('set_comment', { text: { type: 'string' } }),
            actionVariant('create_service'),
            actionVariant('cancel_service'),
            actionVariant('insist_service'),
            actionVariant('escalate_support'),
          ],
        },
      },
    },
  },
}
