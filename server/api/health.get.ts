import { healthInfo } from '~/utils/build'
import { dbEnabled, query } from '../db/client'
import { tokenEncryptionReady } from '../utils/secretCrypto'
import { hydrateKeepAliveHealth, keepAliveHealth } from '../utils/keepAliveStatus'

// Public liveness endpoint: GET /api/health. No secrets.
//
// The readiness flags exist because the OAuth half of this app is invisible from the UI: every page
// renders fine whether or not a single portal ever registered, so a missing variable would only
// surface months later. Booleans only — this endpoint is public, so it must not report how many
// portals are installed or anything else about them.
export default defineEventHandler(async () => {
  const commit = useRuntimeConfig().public.commitSha as string
  if (dbEnabled()) {
    // One DB read per process lifetime (the hydrate flag latches even on failure): the platform
    // recycles the sleeping process, and without this the daily ping would always see the fresh
    // instance's pristine-green flags instead of the persisted outcome of the last real pass.
    await hydrateKeepAliveHealth(query)
  }
  return {
    ...healthInfo(commit),
    ready: {
      db: dbEnabled(),
      oauth: Boolean(process.env.B24_CLIENT_ID && process.env.B24_CLIENT_SECRET),
      encryption: tokenEncryptionReady()
    },
    // Keep-alive outcome flags for the owner's external daily ping: `failing` — the latest pass
    // threw or left portals unrefreshed; `lostGrant` — latched «a portal needs reinstall» since
    // process start. Booleans + one timestamp, same no-counting rule as `ready`.
    keepalive: keepAliveHealth(),
    time: new Date().toISOString()
  }
})
