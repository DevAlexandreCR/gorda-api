// Sentinel error thrown by Session.assertTurnStillValid (design D3) when a turn's
// gate check finds it stale: the newest unprocessed message moved on, or the
// session reached a terminal/manual state (COMPLETED/SUPPORT) mid-turn.
//
// Placed standalone (no imports) so both Session (Models/Session.ts) and
// ResponseContract (Services/chatBot/MessageStrategy/ResponseContract.ts) can
// import it without creating or extending a circular dependency.
export type DiscardedTurnReason = 'superseded' | 'completed' | 'support'

export class DiscardedTurnError extends Error {
  public readonly reason: DiscardedTurnReason

  constructor(reason: DiscardedTurnReason) {
    super(`Turn discarded: ${reason}`)
    this.reason = reason
    this.name = 'DiscardedTurnError'
    // tsconfig target is ES2016 (class syntax preserved, not downleveled to ES5),
    // so `extends Error` already keeps a correct prototype chain here. This line
    // is kept anyway as a defensive guard against a future target downgrade —
    // without it, `instanceof DiscardedTurnError` silently breaks under ES5,
    // which is exactly what Session.processMessage's catch (task 3.5) relies on.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
