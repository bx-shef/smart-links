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
// The in-memory copy alone is NOT enough on the target platform: it recycles the sleeping
// process, so the daily ping would wake a fresh instance with pristine-green flags and the alert
// would never fire (found in review). Hence the write-through to Postgres below — the store is
// guaranteed configured whenever keep-alive has anything to record (keepAliveReady requires it) —
// and a once-per-process hydration read on the health route. Latch semantics get STRONGER with
// persistence: lostGrant now survives restarts; the owner clears it by updating the row after
// handling the affected portal.
//
// Single-process state otherwise, same assumption as every maintenance timer here (CLAUDE.md:
// scale-out needs a lock first).

import type { QueryFn } from '../db/query'
import { parseDbDate } from './tokenStore'

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
  hydrated = false
}

let hydrated = false

/** Write the current snapshot through to Postgres. Failures are logged, never thrown — health
 *  reporting must not break the maintenance pass it reports on. */
export async function persistKeepAliveHealth(query: QueryFn): Promise<void> {
  const s = state
  try {
    await query(
      `INSERT INTO maintenance_health (id, last_run_at, failing, lost_grant, updated_at)
       VALUES ('keepalive', $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET
         last_run_at = EXCLUDED.last_run_at,
         failing     = EXCLUDED.failing,
         -- The latch is OR-ed in SQL too: a restart that lost the in-memory latch must not
         -- overwrite a persisted true with false.
         lost_grant  = maintenance_health.lost_grant OR EXCLUDED.lost_grant,
         updated_at  = now()`,
      [s.lastRunAt, s.failing, s.lostGrant]
    )
  } catch (err) {
    console.error('[keep-alive-health] persist failed:', err)
  }
}

/**
 * Load the persisted snapshot ONCE per process, only while nothing ran in-memory yet. Called from
 * the health route: exactly one DB read per process lifetime (the flag is set even on failure —
 * an unreachable database answers pristine rather than retrying on every public request).
 */
export async function hydrateKeepAliveHealth(query: QueryFn): Promise<void> {
  if (hydrated) {
    return
  }
  // The read happens even when a pass already ran in this process: that pass may have been clean,
  // while the PERSISTED latch still remembers a lost grant from before the restart — skipping the
  // read here would answer green over a database that knows better.
  hydrated = true
  try {
    const { rows } = await query(
      "SELECT last_run_at, failing, lost_grant FROM maintenance_health WHERE id='keepalive'",
      []
    )
    const r = rows[0]
    if (!r) {
      return
    }
    // A pass may have finished while this read was in flight — never overwrite fresher memory.
    if (state.lastRunAt !== null) {
      state = { ...state, lostGrant: state.lostGrant || r.lost_grant === true }
      return
    }
    state = {
      lastRunAt: parseDbDate(r.last_run_at)?.toISOString() ?? null,
      failing: r.failing === true,
      lostGrant: state.lostGrant || r.lost_grant === true
    }
  } catch (err) {
    console.error('[keep-alive-health] hydrate failed:', err)
  }
}
