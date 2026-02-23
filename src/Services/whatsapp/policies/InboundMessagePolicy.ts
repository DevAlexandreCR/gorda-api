import config from '../../../../config'

export type InboundPolicyReason =
  | 'processable'
  | 'old_message'
  | 'invalid_timestamp_processed'
  | 'future_timestamp_processed'

export type InboundPolicyAction = 'process' | 'ignore'

export type InboundMessagePolicyDecision = {
  action: InboundPolicyAction
  reason: InboundPolicyReason
  normalizedTimestamp: number | null
  ageMinutes: number | null
}

type InputTimestamp = number | string | null | undefined

export class InboundMessagePolicy {
  static evaluate(timestamp: InputTimestamp): InboundMessagePolicyDecision {
    const normalizedTimestamp = this.normalizeTimestamp(timestamp)
    if (normalizedTimestamp === null) {
      return {
        action: 'process',
        reason: 'invalid_timestamp_processed',
        normalizedTimestamp: null,
        ageMinutes: null,
      }
    }

    const currentTimestamp = Math.floor(Date.now() / 1000)
    const ageMinutes = (currentTimestamp - normalizedTimestamp) / 60

    if (ageMinutes < 0) {
      return {
        action: 'process',
        reason: 'future_timestamp_processed',
        normalizedTimestamp,
        ageMinutes,
      }
    }

    const maxAgeMinutes = this.getMaxAgeMinutes()
    if (maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) {
      return {
        action: 'ignore',
        reason: 'old_message',
        normalizedTimestamp,
        ageMinutes,
      }
    }

    return {
      action: 'process',
      reason: 'processable',
      normalizedTimestamp,
      ageMinutes,
    }
  }

  private static normalizeTimestamp(timestamp: InputTimestamp): number | null {
    if (timestamp === null || timestamp === undefined) return null
    const parsed = typeof timestamp === 'string' ? Number(timestamp.trim()) : Number(timestamp)
    if (!Number.isFinite(parsed) || parsed <= 0) return null

    if (parsed > 1e12) {
      return Math.floor(parsed / 1000)
    }

    return Math.floor(parsed)
  }

  private static getMaxAgeMinutes(): number {
    const value = Number(config.INBOUND_MESSAGE_MAX_AGE_MINUTES)
    if (!Number.isFinite(value)) return 120
    if (value < 0) return 0
    return value
  }
}
