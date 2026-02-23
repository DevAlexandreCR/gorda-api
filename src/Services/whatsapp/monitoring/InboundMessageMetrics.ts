import config from '../../../../config'

type MetricReason =
  | 'old_message'
  | 'duplicate_message'
  | 'invalid_timestamp_processed'
  | 'future_timestamp_processed'

type MetricPayload = {
  provider: string
  wpClientId: string
  reason: MetricReason
}

class InboundMessageMetrics {
  private readonly counters = new Map<string, number>()
  private readonly flushIntervalSeconds = this.resolveFlushSeconds()

  constructor() {
    const timer = setInterval(() => this.flush(), this.flushIntervalSeconds * 1000)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  public increment(payload: MetricPayload): void {
    const key = this.buildKey(payload.provider, payload.wpClientId, payload.reason)
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1)
  }

  public flush(): void {
    if (this.counters.size === 0) return

    const metrics = Array.from(this.counters.entries()).map(([key, count]) => {
      const [provider, wpClientId, reason] = key.split('|')
      return { provider, wpClientId, reason, count }
    })

    console.log(
      '[InboundMessageMetrics]',
      JSON.stringify({
        at: new Date().toISOString(),
        flushIntervalSeconds: this.flushIntervalSeconds,
        metrics,
      })
    )

    this.counters.clear()
  }

  private buildKey(provider: string, wpClientId: string, reason: string): string {
    return `${provider}|${wpClientId}|${reason}`
  }

  private resolveFlushSeconds(): number {
    const value = Number(config.INBOUND_MESSAGE_METRICS_FLUSH_SECONDS)
    if (!Number.isFinite(value) || value <= 0) return 60
    return Math.floor(value)
  }
}

export default new InboundMessageMetrics()
