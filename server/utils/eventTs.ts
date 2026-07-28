/** How far into the future an event timestamp may sit before we distrust it (clock skew allowance). */
export const EVENT_TS_FUTURE_SLACK_SEC = 5 * 60
/** How far into the past an event timestamp may sit and still be meaningful for ordering. */
export const EVENT_TS_MAX_AGE_SEC = 30 * 24 * 60 * 60

/**
 * Sanitise the `ts` Bitrix puts on an outgoing event (unix SECONDS) before it is used for ordering.
 *
 * The value arrives in the request body, so it is only as trustworthy as the request. It ends up in
 * `portal_tombstone.deleted_ts`, which decides whether a later install is accepted — so a
 * far-future value would both survive every sweep (the sweep compares against now) and reject every
 * future install of that portal, permanently. An implausibly old one is equally useless for
 * ordering. Either way the safe move is to drop the value (0 = "no usable timestamp", which turns
 * the ordering guard off) rather than to trust it.
 *
 * Returns 0 when there is no usable timestamp.
 */
export function clampEventTs(ts: number, nowSec = Math.floor(Date.now() / 1000)): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  const floored = Math.floor(ts)
  if (floored > nowSec + EVENT_TS_FUTURE_SLACK_SEC) return 0
  if (floored < nowSec - EVENT_TS_MAX_AGE_SEC) return 0
  return floored
}
