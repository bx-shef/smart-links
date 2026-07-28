import { extractFrameAuth } from '../utils/frameAuth'
import { verifyFrameToken } from '../utils/frameVerify'
import { markOpened, markPrompted } from '../utils/appRatingStore'
import { parseRatingAction } from '../utils/appRatingRequest'
import { allowFrameRequest } from '../utils/frameRateGuard'
import { query, dbEnabled } from '../db/client'

// POST /api/app-rating — record a rating-prompt lifecycle event for this portal.
//   { action: 'prompted' } — the modal was shown (throttle for RATING_REPROMPT_DAYS).
//   { action: 'opened' }   — the user clicked «Оценить» → we opened the Market page (suppresses
//                            the modal until an owner manually verifies whether a review appeared).
// Frame-token authenticated (the per-portal key is the verified host). Non-fatal for the UX: the
// client ignores errors, but we still return an accurate status.
export default defineEventHandler(async (event) => {
  if (!dbEnabled()) {
    setResponseStatus(event, 503)
    return { error: 'db disabled' }
  }
  // After the DB gate but before verification: verification is what costs an outbound REST call
  // to the portal, and with no store configured the route does no work worth metering.
  if (!allowFrameRequest(event)) {
    return { error: 'rate limited' }
  }
  const auth = extractFrameAuth(getHeaders(event) as Record<string, string | undefined>)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: 'frame auth required' }
  }
  const verified = await verifyFrameToken(auth)
  if (!verified.ok || !verified.host) {
    // The status distinguishes "rejected" from "upstream unavailable"; `verified.reason` stays out
    // of the body so an unauthenticated caller can't use us as an oracle for whether a given token
    // is live on a given portal — our own IP makes those probes, not theirs.
    setResponseStatus(event, verified.status ?? 401)
    return { error: 'authorization failed' }
  }

  const action = parseRatingAction(await readBody(event).catch(() => null))
  if (!action) {
    setResponseStatus(event, 400)
    return { error: 'unknown action' }
  }

  if (action === 'prompted') {
    await markPrompted(verified.host, query)
  } else {
    await markOpened(verified.host, query)
  }
  return { ok: true }
})
