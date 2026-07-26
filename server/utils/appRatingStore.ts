import type { QueryFn } from '../db/query'
import type { AppRatingState } from './appRatingPolicy'

// Per-portal app-rating state over an injected QueryFn (testable without a DB). Keyed by
// `portal_key` — the verified host today, member_id after the OAuth phase (S4); the column is
// generic TEXT so the key source can change without a schema migration. All writes are UPSERTs so
// a portal with no row yet is handled transparently. Adapted from ai-price-import.

/** Read the rating state for a portal, or null when there is no row yet. */
export async function getRatingState(portalKey: string, query: QueryFn): Promise<AppRatingState | null> {
  const { rows } = await query(
    'SELECT prompted_at, opened_at, reviewed FROM app_rating WHERE portal_key=$1',
    [portalKey]
  )
  const r = rows[0]
  if (!r) {
    return null
  }
  // pg returns TIMESTAMPTZ as a Date by default; accept a string too (fakes/other drivers).
  return {
    promptedAt: r.prompted_at ? new Date(r.prompted_at as string | Date) : null,
    openedAt: r.opened_at ? new Date(r.opened_at as string | Date) : null,
    reviewed: r.reviewed === true
  }
}

/** Stamp prompted_at = now() (the modal was actually shown). Upserts the row. Never touches a
 *  confirmed review (defense-in-depth — the policy already stops prompting a reviewed portal). */
export async function markPrompted(portalKey: string, query: QueryFn): Promise<void> {
  await query(
    `INSERT INTO app_rating (portal_key, prompted_at) VALUES ($1, now())
     ON CONFLICT (portal_key) DO UPDATE SET prompted_at = now(), updated_at = now()
       WHERE app_rating.reviewed = false`,
    [portalKey]
  )
}

/** Stamp opened_at = now() (the user clicked «Оценить» → opened the Market page). Upserts the row.
 *  Never overwrites a confirmed review. */
export async function markOpened(portalKey: string, query: QueryFn): Promise<void> {
  await query(
    `INSERT INTO app_rating (portal_key, opened_at) VALUES ($1, now())
     ON CONFLICT (portal_key) DO UPDATE SET opened_at = now(), updated_at = now()
       WHERE app_rating.reviewed = false`,
    [portalKey]
  )
}

/** MANUAL (owner op): mark a confirmed review → terminal, never prompt again. */
export async function markReviewed(portalKey: string, query: QueryFn): Promise<void> {
  await query(
    `INSERT INTO app_rating (portal_key, reviewed) VALUES ($1, true)
     ON CONFLICT (portal_key) DO UPDATE SET reviewed = true, updated_at = now()`,
    [portalKey]
  )
}

/** MANUAL (owner op): clear opened_at AND prompted_at (no review appeared after the verification
 *  window) so the modal shows again on the user's next visit. No-op on a confirmed review. */
export async function clearOpened(portalKey: string, query: QueryFn): Promise<void> {
  await query(
    `UPDATE app_rating SET opened_at = NULL, prompted_at = NULL, updated_at = now()
     WHERE portal_key = $1 AND reviewed = false`,
    [portalKey]
  )
}
