import { CacheStore } from '@whiskeysockets/baileys'

/**
 * Thin `CacheStore`-shaped wrapper over a `Map`, used in place of `node-cache`
 * for Baileys 7.x socket options (e.g. `msgRetryCounterCache`) that only need
 * an in-process key/value cache with no persistence.
 */
export class MapCacheStore implements CacheStore {
  private readonly cache = new Map<string, unknown>()

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value)
  }

  del(key: string): void {
    this.cache.delete(key)
  }

  flushAll(): void {
    this.cache.clear()
  }
}
