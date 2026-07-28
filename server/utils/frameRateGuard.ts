import type { H3Event } from 'h3'
import {
  RATING_MAX_REQUESTS,
  RATING_WINDOW_MS,
  WEBHOOK_MAX_REQUESTS,
  WEBHOOK_WINDOW_MS,
  createRateLimiter
} from './rateLimit'
import { edgeTrustXff, rateLimitKey } from './edgeSecurity'

// One process-wide limiter shared by both /api/app-rating routes: both spend an outbound `profile`
// REST call to the portal on every request in order to verify the frame token, and counting them
// together is what actually bounds that outbound cost.
const limiter = createRateLimiter(RATING_MAX_REQUESTS, RATING_WINDOW_MS)

// The install/uninstall webhook gets its own, tighter budget. It is unauthenticated by necessity,
// and one request costs a database round-trip plus — for an install — an outbound call to a host
// the CALLER named, which makes it an amplifier as well as a load source. Installs are rare, so a
// small budget costs nothing legitimate.
const webhookLimiter = createRateLimiter(WEBHOOK_MAX_REQUESTS, WEBHOOK_WINDOW_MS)

/**
 * Count this request against its client's budget. Returns true when it may proceed; when it may not,
 * the 429 + Retry-After response has already been set on `event` and the handler must return.
 *
 * Called BEFORE frame-token verification on purpose — verifying is the expensive part, so limiting
 * afterwards would leave the cost we are trying to bound fully exposed.
 */
export function allowFrameRequest(event: H3Event): boolean {
  return allow(event, limiter)
}

/** Same, for the public Bitrix24 event webhook. Must run before any I/O the request would cause. */
export function allowWebhookRequest(event: H3Event): boolean {
  return allow(event, webhookLimiter)
}

function allow(event: H3Event, l: { hit: (key: string) => { allowed: boolean, retryAfterSec: number } }): boolean {
  const key = rateLimitKey(
    edgeTrustXff(process.env),
    getHeader(event, 'x-forwarded-for'),
    event.node.req.socket?.remoteAddress
  )
  const decision = l.hit(key)
  if (decision.allowed) return true

  setResponseStatus(event, 429)
  // h3 types Retry-After as a number (it serialises it for us) — passing a string fails typecheck.
  setResponseHeader(event, 'Retry-After', decision.retryAfterSec)
  return false
}
