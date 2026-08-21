// Coalescing for concurrent reloads and jitter for broadcast-triggered ones.
//
// WHY. The `reload.options` pull command goes out on the portal's shared channel and wakes EVERY
// open CRM card whose SmartLink placement is on screen. Each card immediately re-reads the app
// options and the linked record — several REST calls per card, all within the same second, all
// spent from the PORTAL's own request quota. On a portal with a few dozen open cards one admin
// "Save" is a self-inflicted burst into `QUERY_LIMIT_EXCEEDED`: the throttled cards show a load
// error instead of the admin's change. The defect is only visible at scale — a test portal with
// one open card can never reproduce the fan-out, which is why the rules live here under tests
// rather than being checked by eye. (Ported from the reference app, its #480/#482.)

/**
 * One flight shared by all callers, plus AT MOST ONE trailing re-run.
 *
 * Naive coalescing ("a request is in the air — join it") is WRONG here, and not subtly: a request
 * started BEFORE the save returns pre-save data. Callers arrive precisely because settings just
 * changed, so joining them to the old flight would hand them a stale answer and stop — trading
 * correctness for cost in the exact spot the mechanism exists to protect. Instead, callers that
 * arrive mid-flight are remembered as a single flag, and ONE re-run happens after the flight
 * lands — however many arrived. Per tab that is at most two requests instead of N, and the last
 * request is guaranteed to have started after the last event.
 *
 * The pending promise is cleared in `finally`, not `then`: after a failure the next caller must
 * hit the network again, otherwise one hiccup would pin the screen to the error forever.
 *
 * A FAILURE DOES NOT START THE TAIL. Joiners see the same rejection as everyone — they can retry
 * deliberately; an automatic re-run against a portal that is already refusing requests would turn
 * one failure into two requests per tab, adding load exactly when it is least affordable. The
 * queued flag is also cleared EXPLICITLY on rejection: the exception leaves right after `finally`,
 * skipping the tail block, and a flag left armed would force a needless extra request onto the
 * next, unrelated caller. (That leak was caught by a reviewer of the reference implementation —
 * the caller there swallowed errors, so its own tests never saw it.)
 *
 * The task is assumed to be THE SAME across `run()` calls: the tail re-runs the closure captured
 * by the first flight, not the latest caller's. True by construction for the single consumer
 * (re-reading options); a second consumer with different semantics needs an explicit parameter,
 * not silent luck.
 */
export function createSingleFlight(): { run: (task: () => Promise<void>) => Promise<void> } {
  let pending: Promise<void> | null = null
  let queued = false

  function start(task: () => Promise<void>): Promise<void> {
    const p = (async () => {
      try {
        await task()
      } catch (e) {
        queued = false
        throw e
      } finally {
        pending = null
      }
      if (queued) {
        queued = false
        await start(task)
      }
    })()
    pending = p
    return p
  }

  return {
    run(task: () => Promise<void>): Promise<void> {
      if (pending) {
        queued = true
        return pending
      }
      return start(task)
    }
  }
}

/**
 * Spread window for reacting to a BROADCAST event.
 *
 * The jitter is mandatory because the moment is picked by the admin, not by the employee: every
 * open card of every employee receives the signal simultaneously, and without a spread the stock
 * save flow schedules its own burst onto the most expensive path within the same second. A
 * settings change is rare — a couple of seconds of delay costs nothing; the burst costs failed
 * loads for part of the staff. A user's OWN action (opening the card, pressing refresh) gets no
 * delay — the moment there was chosen by a human.
 */
export const SETTINGS_RELOAD_JITTER_MS = 4000

/** Random delay within the spread window. Separate function so tests can substitute the source. */
export function reloadDelayMs(random: () => number = Math.random): number {
  const r = random()
  const safe = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0
  return Math.floor(safe * SETTINGS_RELOAD_JITTER_MS)
}
