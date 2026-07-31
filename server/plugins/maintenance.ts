import { dbEnabled, query } from '../db/client'
import { sweepTombstones } from '../utils/tokenStore'
import { makeOauthRefresh, type FetchLike } from '../utils/b24Oauth'
import { runTokenKeepAlive } from '../utils/tokenKeepAlive'
import { tokenEncryptionReady } from '../utils/secretCrypto'
import { edgeSecurityEnabled } from '../utils/edgeSecurity'
import { readIntEnv } from '../utils/envNumber'
import { checkAppEnv } from '../utils/envCheck'
import { markMaintenanceRun, shouldRunMaintenance } from '../utils/maintenanceSchedule'

// Periodic upkeep for the OAuth store: sweep expired tombstones and refresh portals whose grant is
// approaching its 180-day expiry.
//
// ⚠ Timers alone are NOT enough on the target platform. Bitrix24 Vibecode Black Hole suspends the
// server after about an hour of inactivity, so a process rarely survives long enough for a daily
// `setInterval` to fire — and the portals keep-alive exists for are exactly the idle ones that
// generate no traffic to keep it awake. So the passes are ALSO triggered opportunistically by
// incoming requests, with their own "has enough time passed" check, and the interval is kept as the
// belt-and-braces path for a long-lived process. The owner still needs an external daily ping; that
// is written down in docs/DEPLOY_VIBECODE.md rather than left to be discovered.
//
// A plain interval with no lock because the app runs as ONE process. Two instances would double
// these passes; the sweep is idempotent and harmless, but concurrent keep-alive refreshes of the
// same portal could race on token rotation. Scaling out needs a lock or a designated instance first.

const TOMBSTONE_SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly
const KEEPALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000 // daily

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) {
    return
  }

  const db = dbEnabled()
  const clientId = process.env.B24_CLIENT_ID ?? ''
  const clientSecret = process.env.B24_CLIENT_SECRET ?? ''
  const encKey = process.env.B24_TOKEN_ENC_KEY ?? ''
  const encReady = tokenEncryptionReady()
  const oauthReady = Boolean(clientId && clientSecret)
  const keepAliveReady = db && oauthReady && encReady
  const tombstoneDays = readIntEnv(process.env.TOMBSTONE_TTL_DAYS, 30, 1, 365)

  // One line at startup describing the configuration actually in effect, plus anything that will
  // stop portals from registering. Without it, a deployment missing a variable looks identical to a
  // healthy one — every page serves normally and only the invisible half is dead.
  const report = checkAppEnv({
    dbEnabled: db,
    encryptionReady: encReady,
    edgeSecurity: edgeSecurityEnabled(process.env),
    tombstoneDays,
    env: process.env
  })
  console.info(`[boot] ${report.summary}`)
  for (const w of report.warnings) console.warn(`[boot] ${w}`)
  for (const e of report.errors) console.error(`[boot] ${e}`)

  if (!db) {
    return
  }

  const sweep = async () => {
    try {
      await sweepTombstones(tombstoneDays, query)
    } catch (err) {
      console.error('[maintenance] tombstone sweep failed', (err as Error).message)
    }
  }

  const keepAlive = async () => {
    try {
      const r = await runTokenKeepAlive({
        query,
        refresh: makeOauthRefresh(globalThis.fetch as unknown as FetchLike),
        clientId,
        clientSecret,
        encKey
      })
      if (r.considered > 0) {
        console.info(`[maintenance] token keep-alive: ${r.refreshed}/${r.considered} refreshed, ${r.failed} failed`)
        for (const hash of r.failedPortals) {
          // Pseudonymous hash, never the member_id: enough to tell "the same portal fails daily"
          // from "a different one each time" without putting a customer identifier in a log.
          console.warn(`[maintenance] keep-alive failed for portal=${hash}`)
        }
        for (const hash of r.lostRotations) {
          console.error(
            `[maintenance] portal=${hash} LOST ITS GRANT: the refresh succeeded at Bitrix but could `
            + 'not be saved. This portal can no longer be refreshed — the customer must reinstall the app.'
          )
        }
      }
    } catch (err) {
      console.error('[maintenance] token keep-alive failed', (err as Error).message)
    }
  }

  const runDue = () => {
    if (shouldRunMaintenance('sweep', TOMBSTONE_SWEEP_INTERVAL_MS)) {
      markMaintenanceRun('sweep')
      void sweep()
    }
    if (keepAliveReady && shouldRunMaintenance('keepalive', KEEPALIVE_INTERVAL_MS)) {
      markMaintenanceRun('keepalive')
      void keepAlive()
    }
  }

  // Opportunistic: any request is a chance to catch up after the process was suspended.
  nitroApp.hooks.hook('request', () => runDue())

  // `unref` so the timers never hold the process open during a shutdown.
  setInterval(runDue, TOMBSTONE_SWEEP_INTERVAL_MS).unref()
  runDue()
})
