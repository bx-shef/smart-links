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
    const profile = (await makeCall(auth.domain, auth.accessToken)('profile')) as { ADMIN?: unknown } | null
    return { ok: true, admin: profile?.ADMIN === true, host: normaliseHost(auth.domain) }
  } catch (e) {
    const rejected = isAuthRejection(e)
    return { ok: false, status: rejected ? 401 : 502, reason: rejected ? 'token-rejected' : 'transport' }
  }
}
