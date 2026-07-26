// Pure Bitrix24 REST helpers + the transport contract, ported from the reference
// (ai-price-import). No ambient I/O here — the live bare-token transport lives in
// b24BareToken.ts; this module keeps the shared RestCall type, the SSRF host guard,
// the typed error, and the auth-rejection classifier.

/** A bound REST caller for one portal (domain + access token). The live transport
 *  (b24BareToken.makeBareTokenCall) and any lookup helper share this shape. */
export type RestCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Default per-call REST timeout (ms). A hung portal must not pin a request forever. */
export const REST_TIMEOUT_MS = 15_000

/** Normalise a portal domain to a bare host. */
export function normaliseHost(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
}

/** SSRF guard: only allow Bitrix24 cloud hosts (the domain comes from the client frame). */
export function isSafeB24Domain(domain: string): boolean {
  const host = normaliseHost(domain)
  if (!host || host.includes('@') || host.includes(':')) {
    return false
  }
  return /^([a-z0-9-]+\.)+bitrix24\.[a-z]{2,}$/.test(host) || host === 'oauth.bitrix24.tech'
}

/** Typed B24 REST error carrying the machine-readable code + HTTP status. */
export class B24RestError extends Error {
  constructor(readonly code: string, readonly description: string, readonly status = 0) {
    super(`b24 rest: ${code}${description ? `: ${description}` : ''}`)
    this.name = 'B24RestError'
  }
}

/** True when a REST error means the auth token was REJECTED (forbidden) rather than a
 * transport/network failure — lets callers tell "unauthorised" from "retry later". */
export function isAuthRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return /invalid_token|expired_token|wrong_auth|no_auth|unauthorized|authoriz|invalid_grant|access denied|insufficient_scope|\b401\b|\b403\b/.test(msg)
}
