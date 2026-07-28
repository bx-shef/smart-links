// Fixed-window per-key rate limiter. Pure decision function + a small in-memory store, so the policy
// is unit-testable without a clock or a server.
//
// Why the app needs one at all: every /api/app-rating call is authenticated by VERIFYING the frame
// token, and that verification costs an outbound `profile` REST call to the portal. An unauthenticated
// flood therefore turns into outbound traffic we pay for and the portal rate-limits us on — so the
// limit has to be checked BEFORE verification, not after.
//
// In-memory means per-process: with more than one instance the effective limit multiplies by the
// instance count. That is fine for the single-process deploy target this exists for; a shared store
// would be required before scaling out.

export interface RateLimitEntry {
  count: number
  /** Epoch ms at which the current window ends and the counter resets. */
  resetAt: number
}

export interface RateLimitDecision {
  allowed: boolean
  entry: RateLimitEntry
  /** Seconds until the window resets — the Retry-After value when blocked. */
  retryAfterSec: number
}

/**
 * Decide whether one more request is allowed, and return the entry to store back.
 * A missing or expired entry starts a fresh window.
 */
export function rateLimitDecide(
  entry: RateLimitEntry | undefined,
  now: number,
  max: number,
  windowMs: number
): RateLimitDecision {
  const fresh = !entry || now >= entry.resetAt
  const current: RateLimitEntry = fresh ? { count: 0, resetAt: now + windowMs } : entry
  const next: RateLimitEntry = { count: current.count + 1, resetAt: current.resetAt }
  return {
    allowed: next.count <= max,
    entry: next,
    retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  }
}

export interface RateLimiter {
  /** Count one request against `key` and say whether it may proceed. */
  hit: (key: string, now?: number) => RateLimitDecision
  /** Entries currently held — exposed for tests/diagnostics. */
  size: () => number
}

/**
 * In-memory limiter. Expired entries are swept lazily once the map grows past `maxKeys`, which also
 * bounds memory under an IP-spray: if a sweep cannot get back under the cap the map is cleared
 * outright. Clearing forgives in-flight offenders for one window — deliberately preferred over
 * unbounded growth, since the alternative (evicting nothing) is an OOM and the alternative
 * (rejecting new keys) would let one sprayer lock out every legitimate client.
 */
export function createRateLimiter(max: number, windowMs: number, maxKeys = 10_000): RateLimiter {
  const entries = new Map<string, RateLimitEntry>()

  function sweep(now: number) {
    for (const [k, e] of entries) {
      if (now >= e.resetAt) entries.delete(k)
    }
    if (entries.size > maxKeys) entries.clear()
  }

  return {
    hit(key, now = Date.now()) {
      if (entries.size >= maxKeys) sweep(now)
      const decision = rateLimitDecide(entries.get(key), now, max, windowMs)
      entries.set(key, decision.entry)
      return decision
    },
    size: () => entries.size
  }
}

// Budget for the rating-prompt lifecycle route. A real client posts at most twice per session
// ('prompted', then 'opened'), so this is generous for a human and tight for a script.
export const RATING_MAX_REQUESTS = 30
export const RATING_WINDOW_MS = 10 * 60 * 1000

// Budget for the public install/uninstall webhook. A portal installs the app once and uninstalls it
// once, so even a handful per window is generous for real traffic.
export const WEBHOOK_MAX_REQUESTS = 10
export const WEBHOOK_WINDOW_MS = 10 * 60 * 1000
