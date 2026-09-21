import { NODE_VERSION_FLOOR, isNodeVersionSupported } from '../NodeVersionGuard'

describe('isNodeVersionSupported', () => {
  it('rejects a Node version below the floor', () => {
    expect(isNodeVersionSupported('20.18.0')).toBe(false)
  })

  it('accepts the exact floor version', () => {
    expect(isNodeVersionSupported(NODE_VERSION_FLOOR)).toBe(true)
  })

  it('accepts a later major Node version', () => {
    expect(isNodeVersionSupported('22.0.0')).toBe(true)
  })
})
