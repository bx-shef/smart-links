import { extractFrameAuth } from '../utils/frameAuth'
import { portalKeyForHost, verifyFrameToken } from '../utils/frameVerify'
import { memberIdForDomain } from '../utils/tokenStore'
import { getRatingState } from '../utils/appRatingStore'
import { shouldPrompt } from '../utils/appRatingPolicy'
import { allowFrameRequest } from '../utils/frameRateGuard'
import { query, dbEnabled } from '../db/client'

// GET /api/app-rating — should the in-portal «оцените приложение» modal be shown for this portal?
// Frame-token authenticated. The per-portal key is derived from the VERIFIED host — never trusted
// from the client — and resolves to the installed portal's member_id where one is known. Side-effect-free: it only READS state; the client stamps prompted_at via POST when the
// modal actually renders. Inert (show:false) outside a portal or without a DB.
export default defineEventHandler(async (event) => {
  if (!dbEnabled()) {
    return { show: false } // no store — nothing to prompt
  }
  // After the DB gate but before verification: verification is what costs an outbound REST call
  // to the portal, and with no store configured the route does no work worth metering.
  if (!allowFrameRequest(event)) {
    return { show: false }
  }
  const auth = extractFrameAuth(getHeaders(event) as Record<string, string | undefined>)
  if (!auth) {
    return { show: false } // not in a portal — no nag, no error
  }
  const verified = await verifyFrameToken(auth)
  if (!verified.ok || !verified.host) {
    return { show: false }
  }
  const portalKey = await portalKeyForHost(verified.host, d => memberIdForDomain(d, query))
  if (!portalKey) {
    // The key lookup failed. Doing the work under a fallback key would split this portal's state
    // across two rows, so skip it — this route is best-effort by design.
    return { show: false }
  }
  const state = await getRatingState(portalKey, query)
  return { show: shouldPrompt(state, new Date()) }
})
