import type { QueryFn } from '../db/query'
import { buildRefreshParams, parseTokenResponse } from './b24Oauth'
import { decryptSecret, encryptSecret } from './secretCrypto'
import { updateTokensOnRefresh } from './tokenStore'
import { portalHash } from './portalHash'

// Keep-alive refresh for portals nobody has used lately.
//
// A Bitrix refresh_token is good for ~180 days from ISSUE, not from last use — so a portal that
// installs the app and then sits idle silently loses its credentials on day 180, and the only way
// back is for the customer to reinstall. Refreshing the ones approaching expiry keeps them alive.
//
// Only near-expiry portals are touched: refreshing everything daily would multiply OAuth traffic by
// the number of installs for no benefit, and each refresh ROTATES the token, so it is not free.

/**
 * Refresh a portal this many days before its token would lapse.
 *
 * Wide on purpose. The target platform suspends an idle server, so the pass runs only when
 * something wakes the process — a narrow window would mean a portal had to be lucky enough for a
 * wake-up to land inside its final week. Refreshing early costs one rotation; refreshing too late
 * costs the customer a reinstall.
 */
export const KEEPALIVE_THRESHOLD_DAYS = 60
/** Never refresh more than this many portals in one pass, so a large install base cannot stall boot. */
export const KEEPALIVE_BATCH_CAP = 50
/**
 * Bitrix's refresh_token lifetime, per «Автоматическое продление токенов OAuth 2.0»
 * (https://apidocs.bitrix24.ru/settings/oauth/auto-renewal.html): 180 days.
 * The same page warns against refreshing on a schedule far more often than needed — hence the
 * scan-daily / refresh-only-near-expiry split below.
 */
export const REFRESH_TOKEN_TTL_DAYS = 180

export interface KeepAliveRow {
  memberId: string
  refreshTokenEnc: string
}

export interface KeepAliveDeps {
  query: QueryFn
  /** Performs the OAuth refresh and returns the parsed JSON. */
  refresh: (params: Record<string, string>) => Promise<unknown>
  clientId: string
  clientSecret: string
  encKey: string
  now?: () => number
}

export interface KeepAliveResult {
  considered: number
  refreshed: number
  failed: number
  /** Pseudonymous hashes of the portals that failed, so a repeat offender is identifiable in logs. */
  failedPortals: string[]
}

/**
 * Portals whose token was last refreshed long enough ago to be worth renewing.
 *
 * Keyed on `updated_at` rather than a stored expiry: every write path already touches it, so it
 * cannot drift out of sync with reality the way a separately-maintained expiry column could.
 */
export async function selectTokensNearExpiry(
  query: QueryFn,
  thresholdDays = REFRESH_TOKEN_TTL_DAYS - KEEPALIVE_THRESHOLD_DAYS,
  cap = KEEPALIVE_BATCH_CAP
): Promise<KeepAliveRow[]> {
  const { rows } = await query(
    `SELECT member_id, refresh_token_enc
       FROM portal_tokens
      WHERE refresh_token_enc <> ''
        AND updated_at < now() - ($1 || ' days')::interval
      ORDER BY updated_at ASC
      LIMIT $2`,
    [String(Math.max(1, Math.floor(thresholdDays))), cap]
  )
  return rows.map(r => ({
    memberId: String(r.member_id),
    refreshTokenEnc: String(r.refresh_token_enc ?? '')
  }))
}

/**
 * Refresh every near-expiry portal, persisting each rotated grant.
 *
 * One portal's failure must not stop the pass — a revoked grant (the customer removed the app
 * without us seeing the event) would otherwise block every portal behind it forever.
 */
export async function runTokenKeepAlive(deps: KeepAliveDeps): Promise<KeepAliveResult> {
  const now = deps.now ?? Date.now
  const rows = await selectTokensNearExpiry(deps.query)
  let refreshed = 0
  const failedPortals: string[] = []

  for (const row of rows) {
    try {
      const plaintext = decryptSecret(row.refreshTokenEnc, deps.encKey)
      const raw = await deps.refresh(buildRefreshParams(deps.clientId, deps.clientSecret, plaintext))
      const parsed = parseTokenResponse(raw)
      await updateTokensOnRefresh(
        row.memberId,
        {
          accessToken: parsed.access_token,
          refreshTokenEnc: encryptSecret(parsed.refresh_token, deps.encKey),
          expiresIn: parsed.expires_in,
          issuedAtMs: now()
        },
        deps.query
      )
      refreshed++
    } catch {
      // A member_id identifies a customer portal and stays out of the log; the hash is enough to
      // tell a portal that fails every day from a different one each time.
      failedPortals.push(portalHash(row.memberId))
    }
  }

  return { considered: rows.length, refreshed, failed: failedPortals.length, failedPortals }
}
