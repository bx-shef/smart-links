// In-memory keep-alive health for /api/health (ported idea: «тревога вместо немого снимка»).
//
// Repeated keep-alive failures mean an installed portal silently loses the app by the ~180-day
// refresh-token expiry — and until now the only trace was a log line on a platform that SLEEPS the
// process (nobody tails those logs). The owner already must run an external daily ping against
// /api/health (see docs/DEPLOY_VIBECODE.md); these flags give that ping something to alert on.
//
// Booleans and one timestamp only: /api/health is public, and the flags must not disclose how many
// portals are installed or failing — that invariant is stated on the route itself.
//
// Single-process state, same assumption as every maintenance timer here (CLAUDE.md: scale-out
// needs a lock first).

export interface KeepAliveHealth {
  /** When the last keep-alive pass finished (ISO), null until one runs. */
  lastRunAt: string | null
  /** The most recent pass threw, or left at least one portal unrefreshed. Cleared by a clean pass. */
  failing: boolean
  /**
   * A rotated grant could not be saved at least once since process start. Latched deliberately:
   * the affected portal is unrecoverable without a reinstall, so a later clean pass must not hide
   * that it happened.
   */
  lostGrant: boolean
}

let state: KeepAliveHealth = { lastRunAt: null, failing: false, lostGrant: false }

/** Record the outcome of one keep-alive pass. `outcome: 'error'` means the pass itself threw. */
export function recordKeepAliveRun(
  outcome: { failed: number, lostRotations: number } | 'error',
  now: Date = new Date()
): void {
  const failing = outcome === 'error' || outcome.failed > 0
  const lost = outcome !== 'error' && outcome.lostRotations > 0
  state = {
    lastRunAt: now.toISOString(),
    failing,
    lostGrant: state.lostGrant || lost
  }
}

/** Snapshot for /api/health. */
export function keepAliveHealth(): KeepAliveHealth {
  return { ...state }
}

/** Test-only: return to the pristine state. */
export function resetKeepAliveHealth(): void {
  state = { lastRunAt: null, failing: false, lostGrant: false }
}
