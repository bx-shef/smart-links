import { extractFrameAuth } from '../utils/frameAuth'
import { verifyFrameToken } from '../utils/frameVerify'
import { getRatingState } from '../utils/appRatingStore'
import { shouldPrompt } from '../utils/appRatingPolicy'
import { query, dbEnabled } from '../db/client'

// GET /api/app-rating — should the in-portal «оцените приложение» modal be shown for this portal?
// Frame-token authenticated (the per-portal key is the VERIFIED host — never trusted from the
// client). Side-effect-free: it only READS state; the client stamps prompted_at via POST when the
// modal actually renders. Inert (show:false) outside a portal or without a DB.
export default defineEventHandler(async (event) => {
  if (!dbEnabled()) {
    return { show: false } // no store — nothing to prompt
  }
  const auth = extractFrameAuth(getHeaders(event) as Record<string, string | undefined>)
  if (!auth) {
    return { show: false } // not in a portal — no nag, no error
  }
  const verified = await verifyFrameToken(auth)
  if (!verified.ok || !verified.host) {
    return { show: false }
  }
  const state = await getRatingState(verified.host, query)
  return { show: shouldPrompt(state, new Date()) }
})
