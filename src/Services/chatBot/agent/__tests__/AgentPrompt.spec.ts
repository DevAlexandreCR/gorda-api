import { AGENT_OUTPUT_JSON_SCHEMA, getAgentPrompt } from '../AgentPrompt'

describe('AgentPrompt', () => {
  it('loads a non-empty prompt from src/', () => {
    const prompt = getAgentPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('caches the prompt after the first read (no re-read on subsequent calls)', () => {
    // `jest.spyOn(fs, 'readFileSync')` fails with "Cannot redefine property"
    // on this Node's `fs` module (non-configurable export), so the module is
    // fully mocked instead, inside an isolated registry so it doesn't affect
    // the top-level `getAgentPrompt` import used by the other tests here.
    jest.isolateModules(() => {
      let readCount = 0
      jest.doMock('fs', () => ({
        readFileSync: () => {
          readCount++
          return 'mock prompt content'
        },
      }))

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const isolatedAgentPrompt = require('../AgentPrompt')
      const first = isolatedAgentPrompt.getAgentPrompt()
      expect(readCount).toBe(1)

      const second = isolatedAgentPrompt.getAgentPrompt()
      expect(second).toBe(first)
      expect(readCount).toBe(1)
    })
  })

  it('exposes a schema that is a valid JSON object', () => {
    const serialized = JSON.stringify(AGENT_OUTPUT_JSON_SCHEMA)
    expect(() => JSON.parse(serialized)).not.toThrow()

    expect(AGENT_OUTPUT_JSON_SCHEMA.name).toBe('agent_output')
    const schema = AGENT_OUTPUT_JSON_SCHEMA.schema as {
      required: string[]
      additionalProperties: boolean
      properties: {
        actions: { items: { anyOf: Array<{ properties: { type: { enum: string[] } } }> } }
      }
    }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['reply', 'actions'])

    const actionTypes = schema.properties.actions.items.anyOf.map(
      (variant) => variant.properties.type.enum[0]
    )
    expect(actionTypes).toEqual([
      'set_client_name',
      'set_place',
      'set_place_from_location',
      'set_comment',
      'create_service',
      'cancel_service',
      'insist_service',
      'escalate_support',
    ])
  })
})
