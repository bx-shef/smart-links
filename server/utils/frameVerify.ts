import type { RestCall } from './b24Rest'
import { isAuthRejection, normaliseHost } from './b24Rest'
import { makeBareTokenCall } from './b24BareToken'
import type { FrameAuth } from './frameAuth'

// Verify an in-portal frame request: the client cannot be trusted to send its own
// identity, so we prove the frame token controls its `domain` with a cheap authenticated
// `profile` call. The verified domain (host) is the trusted per-portal key. DI over the
// REST factory → unit-tested with a fake. Ported/adapted from ai-price-import.

export interface FrameVerifyDeps {
  /** Bare-token REST factory. Prod uses makeBareTokenCall; tests inject a fake. */
  makeCall?: (domain: string, accessToken: string) => RestCall
}

export interface FrameVerifyResult {
  ok: boolean
  /** True when the calling user is a portal administrator (profile.ADMIN). */
  admin?: boolean
  /** Canonical (normalised) portal host — the trusted per-portal key. Set only when ok. */
  host?: string
  /** 401 = token rejected; 502 = verification transport error. */
  status?: 401 | 502
  reason?: 'token-rejected' | 'transport'
}

/**
 * Verify the frame token controls its portal (an authed `profile` call), read the caller's
 * ADMIN flag, and return the canonical host as the trusted per-portal key. Never throws.
 */
export async function verifyFrameToken(auth: FrameAuth, deps: FrameVerifyDeps = {}): Promise<FrameVerifyResult> {
  try {
    const makeCall = deps.makeCall ?? makeBareTokenCall
    const profile = (await makeCall(auth.domain, auth.accessToken)('profile')) as { ID?: unknown, ADMIN?: unknown } | null
    // A real `profile` result always identifies a user. Requiring that — rather than accepting
    // whatever came back — keeps "the host answered without erroring" from counting as proof that
    // the token controls the portal.
    if (!profile || typeof profile !== 'object' || profile.ID === undefined) {
      return { ok: false, status: 401, reason: 'token-rejected' }
    }
    return { ok: true, admin: profile.ADMIN === true, host: normaliseHost(auth.domain) }
  } catch (e) {
    const rejected = isAuthRejection(e)
    return { ok: false, status: rejected ? 401 : 502, reason: rejected ? 'token-rejected' : 'transport' }
  }
}

/**
 * Pick the per-portal storage key for a verified frame request.
 *
 * Prefer the installed portal's `member_id` — Bitrix's own identifier, which the install flow
 * migrates the portal's existing state onto. A portal we have never seen an install event for (the
 * app added by hand, or installed before the OAuth phase) still falls back to its verified host, so
 * it keeps working rather than losing its state.
 *
 * ⚠ The resolution itself goes host → member_id, so it only holds while the portal keeps its
 * address; a renamed portal will not be found and falls back to its new host.
 *
 * Returns null when the lookup FAILED (as opposed to finding nothing). A failure must not quietly
 * become the host key: with the database half-available, reads would resolve to member_id and
 * writes to the host, splitting one portal's state across two rows. Callers treat null as "no
 * usable key" and skip the work.
 *
 * `lookup` is injected so this stays testable without a database.
 */
export async function portalKeyForHost(
  host: string,
  lookup: (domain: string) => Promise<string | null>
): Promise<string | null> {
  try {
    return (await lookup(host)) || host
  } catch {
    return null
  }
}
