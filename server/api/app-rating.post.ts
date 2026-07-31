import { extractFrameAuth } from '../utils/frameAuth'
import { portalKeyForHost, verifyFrameToken } from '../utils/frameVerify'
import { memberIdForDomain } from '../utils/tokenStore'
import { markOpened, markPrompted } from '../utils/appRatingStore'
import { parseRatingAction } from '../utils/appRatingRequest'
import { allowFrameRequest } from '../utils/frameRateGuard'
import { query, dbEnabled } from '../db/client'

// POST /api/app-rating — record a rating-prompt lifecycle event for this portal.
//   { action: 'prompted' } — the modal was shown (throttle for RATING_REPROMPT_DAYS).
//   { action: 'opened' }   — the user clicked «Оценить» → we opened the Market page (suppresses
//                            the modal until an owner manually verifies whether a review appeared).
// Frame-token authenticated (the per-portal key comes from the verified host, resolving to the
// installed portal's member_id where one is known). Non-fatal for the UX: the
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
    // One status for every verification failure. The body already hides `verified.reason`, but a
    // 401-vs-502 split still let an outside caller tell "that bitrix24 host exists and rejected
    // the token" from "no such host" — with our server doing the probing. The legitimate caller
    // (our own frame client) treats any failure the same way, so the distinction bought nothing.
    setResponseStatus(event, 401)
    return { error: 'authorization failed' }
  }

  const action = parseRatingAction(await readBody(event).catch(() => null))
  if (!action) {
    setResponseStatus(event, 400)
    return { error: 'unknown action' }
  }

  const portalKey = await portalKeyForHost(verified.host, d => memberIdForDomain(d, query))
  if (!portalKey) {
    // The key lookup failed. Doing the work under a fallback key would split this portal's state
    // across two rows, so skip it — this route is best-effort by design.
    setResponseStatus(event, 503)
    return { error: 'portal key unavailable' }
  }
  // Same discipline as the events webhook: a Postgres hiccup answers OUR error shape with a 503,
  // not Nitro's default 500 — this route's failures are non-fatal to the client by design.
  try {
    if (action === 'prompted') {
      await markPrompted(portalKey, query)
    } else {
      await markOpened(portalKey, query)
    }
  } catch (err) {
    console.error('[app-rating] write failed:', (err as Error).message)
    setResponseStatus(event, 503)
    return { error: 'storage unavailable' }
  }
  return { ok: true }
})
