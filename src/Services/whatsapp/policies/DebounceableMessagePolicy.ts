import { MessageTypes } from '../constants/MessageTypes'
import { WpMessageInterface } from '../interfaces/WpMessageInterface'

/**
 * A message is "debounceable" when it should ride the sliding text debounce
 * window (typing indicator + CHATBOT_DEBOUNCE_MS delay). LOCATION and
 * INTERACTIVE (button reply) messages get instant (delay: 0) handling instead
 * — see design.md D5 for the shared predicate used at both the typing-indicator
 * call site and the turn-enqueue delay decision.
 */
export function isDebounceableMsg(msg: WpMessageInterface): boolean {
  return msg.type === MessageTypes.TEXT
}
