import type { H3Event } from 'h3'
import { RATING_MAX_REQUESTS, RATING_WINDOW_MS, createRateLimiter } from './rateLimit'
import { edgeTrustXff, rateLimitKey } from './edgeSecurity'

// One process-wide limiter shared by both /api/app-rating routes: they are the only public entry
// points, and both spend an outbound `profile` REST call to the portal on every request in order to
// verify the frame token. Counting them together is what actually bounds that outbound cost.
const limiter = createRateLimiter(RATING_MAX_REQUESTS, RATING_WINDOW_MS)

/**
 * Count this request against its client's budget. Returns true when it may proceed; when it may not,
 * the 429 + Retry-After response has already been set on `event` and the handler must return.
 *
 * Called BEFORE frame-token verification on purpose — verifying is the expensive part, so limiting
 * afterwards would leave the cost we are trying to bound fully exposed.
 */
export function allowFrameRequest(event: H3Event): boolean {
  const key = rateLimitKey(
    edgeTrustXff(process.env),
    getHeader(event, 'x-forwarded-for'),
    event.node.req.socket?.remoteAddress
  )
  const decision = limiter.hit(key)
  if (decision.allowed) return true

  setResponseStatus(event, 429)
  // h3 types Retry-After as a number (it serialises it for us) — passing a string fails typecheck.
  setResponseHeader(event, 'Retry-After', decision.retryAfterSec)
  return false
}
