import config from '../../../../config'

export type InboundDedupDecision = {
  action: 'process' | 'ignore'
  reason: 'processable' | 'duplicate_message'
}

class InboundMessageDedupCache {
  private readonly dedupMap = new Map<string, number>()
  private readonly defaultTtlSeconds = 21600
  private readonly cleanupIntervalMs = 60000
  private lastCleanupAt = 0

  evaluate(wpClientId: string, messageId: string): InboundDedupDecision {
    if (!wpClientId || !messageId) {
      return { action: 'process', reason: 'processable' }
    }

    const now = Date.now()
    this.evictExpiredEntries(now)
    const key = `${wpClientId}:${messageId}`
    const expiresAt = this.dedupMap.get(key)

    if (expiresAt && expiresAt > now) {
      return { action: 'ignore', reason: 'duplicate_message' }
    }

    const ttlSeconds = this.getTtlSeconds()
    this.dedupMap.set(key, now + ttlSeconds * 1000)
    return { action: 'process', reason: 'processable' }
  }

  private evictExpiredEntries(now: number): void {
    if (now - this.lastCleanupAt < this.cleanupIntervalMs) return

    this.dedupMap.forEach((expiresAt, key) => {
      if (expiresAt <= now) {
        this.dedupMap.delete(key)
      }
    })
    this.lastCleanupAt = now
  }

  private getTtlSeconds(): number {
    const value = Number(config.INBOUND_MESSAGE_DEDUP_TTL_SECONDS)
    if (!Number.isFinite(value) || value <= 0) {
      return this.defaultTtlSeconds
    }
    return Math.floor(value)
  }
}

export default new InboundMessageDedupCache()
