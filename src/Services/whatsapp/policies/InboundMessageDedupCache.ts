import config from '../../../../config'
import ProcessedInboundMessageRepository from '../../../Repositories/ProcessedInboundMessageRepository'

export type InboundDedupDecision = {
  action: 'process' | 'ignore'
  reason: 'processable' | 'duplicate_message'
}

class InboundMessageDedupCache {
  private readonly dedupMap = new Map<string, number>()
  private readonly defaultTtlSeconds = 21600
  private readonly cleanupIntervalMs = 60000
  private lastCleanupAt = 0

  async evaluate(wpClientId: string, messageId: string): Promise<InboundDedupDecision> {
    if (!wpClientId || !messageId) {
      return { action: 'process', reason: 'processable' }
    }

    const now = Date.now()
    this.evictExpiredEntries(now)
    const key = `${wpClientId}:${messageId}`

    // L1: in-memory cache hit
    const expiresAt = this.dedupMap.get(key)
    if (expiresAt && expiresAt > now) {
      return { action: 'ignore', reason: 'duplicate_message' }
    }

    // L2: persistent PostgreSQL lookup (fail-open on error)
    try {
      const existsInDb = await ProcessedInboundMessageRepository.exists(wpClientId, messageId)
      if (existsInDb) {
        // Repopulate L1 so subsequent checks are fast
        const ttlSeconds = this.getTtlSeconds()
        this.dedupMap.set(key, now + ttlSeconds * 1000)
        return { action: 'ignore', reason: 'duplicate_message' }
      }
    } catch (error: any) {
      console.log('[InboundMessageDedupCache] L2 lookup failed, proceeding (fail-open)', error?.message)
    }

    // New message — register in L1 (L2 registration is handled by the caller via recordProcessed)
    const ttlSeconds = this.getTtlSeconds()
    this.dedupMap.set(key, now + ttlSeconds * 1000)
    return { action: 'process', reason: 'processable' }
  }

  async recordProcessed(wpClientId: string, messageId: string, provider: string): Promise<void> {
    try {
      await ProcessedInboundMessageRepository.record(wpClientId, messageId, provider)
    } catch (error: any) {
      console.log('[InboundMessageDedupCache] L2 record failed', error?.message)
    }
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
