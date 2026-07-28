/**
 * "Has enough time passed to run this pass again?" — in-process, per named job.
 *
 * Kept separate from the timers because the target platform suspends an idle server, so a plain
 * `setInterval` cannot be the only trigger: the pass also fires on incoming requests, and without a
 * memory of the last run a busy period would re-run it on every request.
 *
 * In-process only, so a restart forgets and the next request runs the pass once more. That is the
 * safe direction for both jobs here — the tombstone sweep is idempotent, and keep-alive only
 * refreshes portals genuinely near expiry, so an extra pass costs one query and no rotations.
 */
const lastRun = new Map<string, number>()

export function shouldRunMaintenance(job: string, intervalMs: number, now = Date.now()): boolean {
  const previous = lastRun.get(job)
  return previous === undefined || now - previous >= intervalMs
}

export function markMaintenanceRun(job: string, now = Date.now()): void {
  lastRun.set(job, now)
}

/** Test helper — drops the recorded run times. */
export function resetMaintenanceSchedule(): void {
  lastRun.clear()
}
