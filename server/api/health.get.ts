import { healthInfo } from '~/utils/build'
import { dbEnabled } from '../db/client'
import { tokenEncryptionReady } from '../utils/secretCrypto'

// Public liveness endpoint: GET /api/health. No secrets.
//
// The readiness flags exist because the OAuth half of this app is invisible from the UI: every page
// renders fine whether or not a single portal ever registered, so a missing variable would only
// surface months later. Booleans only — this endpoint is public, so it must not report how many
// portals are installed or anything else about them.
export default defineEventHandler(() => {
  const commit = useRuntimeConfig().public.commitSha as string
  return {
    ...healthInfo(commit),
    ready: {
      db: dbEnabled(),
      oauth: Boolean(process.env.B24_CLIENT_ID && process.env.B24_CLIENT_SECRET),
      encryption: tokenEncryptionReady()
    },
    time: new Date().toISOString()
  }
})
