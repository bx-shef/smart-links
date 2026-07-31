import type { QueryFn } from '../db/query'

// Per-portal OAuth credential store over an injected QueryFn (so the logic is testable without a
// database). Adapted from the reference app (ai-price-import), minus its queue: this app has a
// single process, so the route writes here directly.

export interface SaveTokenInput {
  memberId: string
  domain: string
  clientEndpoint: string
  accessToken: string
  /** Already encrypted by the caller — plaintext refresh tokens never reach this module. */
  refreshTokenEnc: string
  applicationToken: string
  expiresIn: number
  issuedAtMs: number
}

export interface PortalToken {
  memberId: string
  domain: string
  clientEndpoint: string
  accessToken: string
  refreshTokenEnc: string
  expiresIn: number
  issuedAtMs: number
}

/**
 * Register (or re-register) a portal.
 *
 * Returns false when the write was REFUSED because a newer uninstall is on record — see the
 * tombstone note in db/schema.ts. `eventTs` is the Bitrix event timestamp in unix seconds; 0 means
 * the webhook carried none, in which case the guard cannot compare and stays out of the way.
 */
export async function saveToken(input: SaveTokenInput, query: QueryFn, eventTs = 0): Promise<boolean> {
  if (eventTs > 0) {
    const { rows } = await query('SELECT deleted_ts FROM portal_tombstone WHERE member_id=$1', [input.memberId])
    const deletedTs = Number(rows[0]?.deleted_ts ?? 0)
    if (deletedTs > 0 && deletedTs >= eventTs) {
      return false // this install predates (or ties) the uninstall that superseded it
    }
  }

  await query(
    `INSERT INTO portal_tokens (
       member_id, domain, client_endpoint, access_token, refresh_token_enc,
       application_token, expires_in, issued_at_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (member_id) DO UPDATE SET
       domain            = EXCLUDED.domain,
       -- COALESCE/NULLIF: a re-registration that carries no credentials (an event shape without
       -- tokens) must not blank out the working ones. Overwriting them with '' left a portal that
       -- looked installed but could never be refreshed, and keep-alive skips empty rows, so it
       -- would never have been noticed.
       client_endpoint   = COALESCE(NULLIF(EXCLUDED.client_endpoint, ''), portal_tokens.client_endpoint),
       access_token      = COALESCE(NULLIF(EXCLUDED.access_token, ''), portal_tokens.access_token),
       refresh_token_enc = COALESCE(NULLIF(EXCLUDED.refresh_token_enc, ''), portal_tokens.refresh_token_enc),
       application_token = COALESCE(NULLIF(EXCLUDED.application_token, ''), portal_tokens.application_token),
       expires_in        = EXCLUDED.expires_in,
       issued_at_ms      = EXCLUDED.issued_at_ms,
       updated_at        = now()`,
    [
      input.memberId,
      input.domain,
      input.clientEndpoint,
      input.accessToken,
      input.refreshTokenEnc,
      input.applicationToken,
      input.expiresIn,
      input.issuedAtMs
    ]
  )

  // A successful (re)install clears the tombstone: the portal is legitimately back, and leaving the
  // row would make the NEXT install of the same portal look stale and be refused.
  await query('DELETE FROM portal_tombstone WHERE member_id=$1', [input.memberId])
  return true
}

/**
 * Persist a rotated grant after a refresh. UPDATE-only on purpose: if the portal was uninstalled
 * while the refresh was in flight, an upsert would resurrect the row we just deleted.
 */
export async function updateTokensOnRefresh(
  memberId: string,
  fields: { accessToken: string, refreshTokenEnc: string, expiresIn: number, issuedAtMs: number },
  query: QueryFn
): Promise<void> {
  await query(
    `UPDATE portal_tokens
        SET access_token=$2, refresh_token_enc=$3, expires_in=$4, issued_at_ms=$5, updated_at=now()
      WHERE member_id=$1`,
    [memberId, fields.accessToken, fields.refreshTokenEnc, fields.expiresIn, fields.issuedAtMs]
  )
}

/**
 * Remove a portal and record the uninstall so a late install cannot resurrect it.
 *
 * The tombstone is written FIRST, before anything is deleted. These are separate statements with no
 * transaction between them (QueryFn has no transaction support, and the platform can suspend this
 * process at any point), so the order decides which half-finished state is survivable:
 *
 *   tombstone → delete   a crash in between leaves a tombstone and a still-registered portal. The
 *                        real uninstall is simply retried or the portal reinstalls with a later ts,
 *                        which passes the guard. Harmless.
 *   delete → tombstone   a crash in between leaves the portal deleted with NO tombstone — exactly
 *                        the state the tombstone exists to prevent, so a delayed install would
 *                        resurrect a portal the customer removed.
 */
export async function deletePortal(memberId: string, query: QueryFn, eventTs = 0, domain = ''): Promise<void> {
  if (eventTs > 0) {
    await query(
      `INSERT INTO portal_tombstone (member_id, deleted_ts) VALUES ($1,$2)
       ON CONFLICT (member_id) DO UPDATE SET deleted_ts = GREATEST(portal_tombstone.deleted_ts, EXCLUDED.deleted_ts)`,
      [memberId, eventTs]
    )
  }
  await query('DELETE FROM portal_tokens WHERE member_id=$1', [memberId])
  // The rating row is per-portal state about a customer who just removed the app — delete it with
  // everything else rather than keep it against a portal that no longer exists. Both keys, because
  // a portal seen before it ever registered is keyed by host, and that row is not otherwise swept.
  await query('DELETE FROM app_rating WHERE portal_key = ANY($1)', [[memberId, domain].filter(Boolean)])
}

/**
 * Move a portal's rating state from its host key onto its member_id, once we learn the member_id.
 *
 * Before a portal registers we can only key its state by verified host. Switching keys on
 * registration without moving the row would silently reset that state: a customer who already left
 * a Market review would be prompted again, because `reviewed` lived under the old key. The old row
 * is dropped either way, so nothing is left behind for the uninstall sweep to miss.
 */
export async function migrateRatingKey(domain: string, memberId: string, query: QueryFn): Promise<void> {
  if (!domain || !memberId || domain === memberId) return
  // ON CONFLICT DO NOTHING: if a row already exists under member_id it is the newer truth, and the
  // host-keyed row is the leftover — keep the former, delete the latter.
  await query(
    `INSERT INTO app_rating (portal_key, prompted_at, opened_at, reviewed, created_at)
     SELECT $2, prompted_at, opened_at, reviewed, created_at FROM app_rating WHERE portal_key=$1
     ON CONFLICT (portal_key) DO NOTHING`,
    [domain, memberId]
  )
  await query('DELETE FROM app_rating WHERE portal_key=$1', [domain])
}

/** The portal's remembered application_token, or null when the portal is unknown. */
export async function getApplicationToken(memberId: string, query: QueryFn): Promise<string | null> {
  const { rows } = await query('SELECT application_token FROM portal_tokens WHERE member_id=$1', [memberId])
  const token = rows[0]?.application_token
  return typeof token === 'string' && token ? token : null
}

/** Full credentials for a portal, or null when it is not installed. */
export async function getPortalToken(memberId: string, query: QueryFn): Promise<PortalToken | null> {
  const { rows } = await query(
    `SELECT member_id, domain, client_endpoint, access_token, refresh_token_enc, expires_in, issued_at_ms
       FROM portal_tokens WHERE member_id=$1`,
    [memberId]
  )
  const r = rows[0]
  if (!r) return null
  return {
    memberId: String(r.member_id),
    domain: String(r.domain),
    clientEndpoint: String(r.client_endpoint ?? ''),
    accessToken: String(r.access_token ?? ''),
    refreshTokenEnc: String(r.refresh_token_enc ?? ''),
    expiresIn: Number(r.expires_in ?? 3600),
    issuedAtMs: Number(r.issued_at_ms ?? 0)
  }
}

/**
 * Resolve an installed portal's member_id from its (already verified) host.
 *
 * Returns null when the host is not installed — the caller must NOT invent a key from the host in
 * that case, or two portals that happen to share a host across a rename would collide.
 */
export async function memberIdForDomain(domain: string, query: QueryFn): Promise<string | null> {
  // ORDER BY, because `domain` is not unique: a portal that renames leaves its old address behind,
  // and if another portal later takes that address both rows match. Newest wins, deterministically,
  // instead of whichever row the planner happened to return.
  const { rows } = await query(
    'SELECT member_id FROM portal_tokens WHERE domain=$1 ORDER BY updated_at DESC LIMIT 1',
    [domain]
  )
  const id = rows[0]?.member_id
  return typeof id === 'string' && id ? id : null
}

/** Drop tombstones older than `days` — see the growth note in db/schema.ts. */
export async function sweepTombstones(days: number, query: QueryFn): Promise<void> {
  // deleted_ts is in SECONDS, and so is EXTRACT(EPOCH …) — a stray milliseconds value simply never
  // matches and lingers, rather than being swept ~1000x too early.
  // Guard NaN here rather than trusting the caller: Postgres compares `x < now - 'NaN'` as TRUE,
  // so a single bad value would silently delete every tombstone — the opposite of this function's job.
  const safeDays = Number.isFinite(days) ? Math.max(1, days) : 30
  await query(
    'DELETE FROM portal_tombstone WHERE deleted_ts < EXTRACT(EPOCH FROM now()) - $1',
    [safeDays * 24 * 60 * 60]
  )
}
