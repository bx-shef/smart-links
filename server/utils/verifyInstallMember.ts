import { buildRefreshParams, parseTokenResponse, type B24TokenResponse } from './b24Oauth'
import { isAuthRejection } from './b24Rest'

// Install-time member_id binding.
//
// The first ONAPPINSTALL delivers member_id as a CLIENT-CONTROLLED field. Verifying the delivered
// access_token proves control of the DOMAIN, but says nothing about member_id — so an attacker who
// controls any real portal A could forge an install carrying a victim's member_id together with
// A's genuine token, and poison the victim's row (a targeted denial of service against a specific
// customer, not a data leak, but bad enough).
//
// The bind closes that: refreshing the delivered refresh_token makes the OAuth token endpoint
// return the AUTHORITATIVE member_id of that grant, which must equal the claimed one.
//
// Note the refresh ROTATES the grant, so on success the caller must store the RETURNED credentials
// — the delivered refresh_token is spent by the time this returns.

export interface InstallMemberDeps {
  /** Performs the OAuth token refresh with the given params and returns the parsed JSON. */
  refresh: (params: Record<string, string>) => Promise<unknown>
  clientId: string
  clientSecret: string
}

/** The rotated grant from a successful bind. `refreshToken` is plaintext — the caller encrypts it. */
export interface RefreshedGrant {
  accessToken: string
  refreshToken: string
  clientEndpoint: string
  expiresIn: number
}

export interface InstallMemberResult {
  ok: boolean
  /** 403 = member_id rejected (spoofed or forged grant); 503 = cannot verify right now. */
  status?: 403 | 503
  grant?: RefreshedGrant
}

/**
 * Verify the claimed install member_id against the authoritative one from the OAuth grant.
 *
 * Fail-closed, and the two failure modes are kept apart deliberately: anything that means "this is
 * not a genuine grant for that portal" is a permanent 403, while anything that means "we could not
 * check" (network, our own misconfiguration, a response with no member_id) is a 503 — a real
 * install must not be rejected forever because the OAuth server blipped. Never throws.
 */
export async function verifyInstallMember(
  claimedMemberId: string,
  refreshToken: string,
  deps: InstallMemberDeps
): Promise<InstallMemberResult> {
  const claimed = claimedMemberId.trim().toLowerCase()
  // Nothing to bind against ⇒ reject rather than accept an unverifiable claim.
  if (!claimed || !refreshToken) {
    return { ok: false, status: 403 }
  }

  let raw: unknown
  try {
    raw = await deps.refresh(buildRefreshParams(deps.clientId, deps.clientSecret, refreshToken))
  } catch {
    return { ok: false, status: 503 }
  }

  // Coerce to an object BEFORE using `in`: a JSON primitive (say, a misconfigured proxy returning
  // a bare string) would make `'error' in <primitive>` throw and escape the fail-closed contract.
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if ('error' in o) {
    // Classify by the machine code, not the human-readable description: invalid_grant and friends
    // mean the token is not a genuine grant (forged install → 403); wrong_client or anything else
    // points at our own configuration and is retryable (→ 503).
    return { ok: false, status: isAuthRejection(String(o.error)) ? 403 : 503 }
  }

  let parsed: B24TokenResponse
  try {
    parsed = parseTokenResponse(raw)
  } catch {
    return { ok: false, status: 503 } // success-shaped but malformed — cannot verify
  }

  const authoritative = String(parsed.member_id ?? '').trim().toLowerCase()
  // A genuine grant always echoes member_id; an empty one means we cannot bind, not that the
  // install is fake — 503, so a real customer is not turned away.
  if (!authoritative) {
    return { ok: false, status: 503 }
  }
  if (authoritative !== claimed) {
    return { ok: false, status: 403 }
  }

  return {
    ok: true,
    grant: {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      clientEndpoint: parsed.client_endpoint || '',
      expiresIn: parsed.expires_in
    }
  }
}
