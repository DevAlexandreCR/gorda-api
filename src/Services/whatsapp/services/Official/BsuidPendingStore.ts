import { WebhookMessage } from './resolveOfficialSender'

// This store is in-process (a plain in-memory Map) and is lost on restart by design: the
// 30-minute pending window is normally seconds long in practice, and the GREETING fallback
// (design D4 in support-wp-bsuid-phone-request) exists precisely to cover the restart gap,
// so no durable persistence is used here.

type PendingEntry = {
  message: WebhookMessage
  profileName?: string
  storedAt: number
}

type StoreEntry = {
  lastRequestAt?: number
  pending?: PendingEntry
}

const RATE_LIMIT_MS = 10 * 60 * 1000
const PENDING_TTL_MS = 30 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60000

class BsuidPendingStore {
  private readonly entries = new Map<string, StoreEntry>()
  private lastCleanupAt = 0

  canRequest(key: string): boolean {
    const now = Date.now()
    this.evictExpiredEntries(now)
    const entry = this.entries.get(key)
    if (!entry?.lastRequestAt) {
      return true
    }
    return now - entry.lastRequestAt >= RATE_LIMIT_MS
  }

  markRequested(key: string): void {
    const entry = this.entries.get(key) ?? {}
    entry.lastRequestAt = Date.now()
    this.entries.set(key, entry)
  }

  rememberPending(key: string, message: WebhookMessage, profileName?: string): void {
    const entry = this.entries.get(key) ?? {}
    entry.pending = { message, profileName, storedAt: Date.now() }
    this.entries.set(key, entry)
  }

  takePending(key: string): PendingEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry?.pending) {
      return undefined
    }

    const pending = entry.pending
    entry.pending = undefined

    if (Date.now() - pending.storedAt >= PENDING_TTL_MS) {
      return undefined
    }

    return pending
  }

  // Test-only reset: this class is exported as a module-level singleton, so specs that
  // exercise it (directly or through MessageController) need a way to clear state between
  // test cases without restarting the process. Never called from production code.
  reset(): void {
    this.entries.clear()
    this.lastCleanupAt = 0
  }

  private evictExpiredEntries(now: number): void {
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return
    }

    this.entries.forEach((entry, key) => {
      const requestExpired = !entry.lastRequestAt || now - entry.lastRequestAt >= RATE_LIMIT_MS
      const pendingExpired = !entry.pending || now - entry.pending.storedAt >= PENDING_TTL_MS

      if (requestExpired) {
        entry.lastRequestAt = undefined
      }
      if (pendingExpired) {
        entry.pending = undefined
      }
      if (!entry.lastRequestAt && !entry.pending) {
        this.entries.delete(key)
      }
    })
    this.lastCleanupAt = now
  }
}

export default new BsuidPendingStore()
