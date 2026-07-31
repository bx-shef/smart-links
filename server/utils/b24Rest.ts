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

/**
 * Bitrix24 cloud zones a portal domain may live in.
 *
 * An explicit list, not `bitrix24.<any TLD>`: Bitrix does not own every TLD, so the open pattern
 * would accept an attacker-registered `bitrix24.<free-tld>`. That host could answer the frame-token
 * verification call itself, which is what makes the domain "verified" — turning the guard into a
 * rubber stamp and letting anyone mint arbitrary portal keys and point our outbound calls at their
 * server. The list bounds that to hosts Bitrix actually controls.
 *
 * ⚠ Bitrix publishes no machine-readable list of zones, so this one is assembled by observation and
 * MUST be re-checked against the live Market before release. `B24_EXTRA_ZONES` (comma-separated)
 * exists so a zone we missed is a config change, not an outage waiting on a deploy.
 */
export const B24_ZONES = [
  // Verified live: a wildcard portal subdomain resolves and answers /rest like bitrix24.ru does.
  'bitrix24.ru', 'bitrix24.by', 'bitrix24.kz', 'bitrix24.uz',
  'bitrix24.com', 'bitrix24.eu', 'bitrix24.de', 'bitrix24.es', 'bitrix24.fr',
  'bitrix24.it', 'bitrix24.pl', 'bitrix24.uk', 'bitrix24.co', 'bitrix24.ae',
  'bitrix24.in', 'bitrix24.vn', 'bitrix24.jp', 'bitrix24.cn', 'bitrix24.mx',
  'bitrix24.id', 'bitrix24.com.br', 'bitrix24.com.tr'
  // Deliberately absent: bitrix24.ua has no DNS at all (an allowlisted domain nobody controls is
  // the very hole this guard exists to close); bitrix24.co.uk is not a portal zone (.uk is);
  // bitrix24.tech hosts the OAuth server, not portals.
] as const

export function allowedZones(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.B24_EXTRA_ZONES ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return [...B24_ZONES, ...extra]
}

/** SSRF guard: only allow Bitrix24 cloud hosts (the domain comes from the client frame). */
export function isSafeB24Domain(domain: string, env?: Record<string, string | undefined>): boolean {
  const host = normaliseHost(domain)
  // Reject userinfo (`user@evil`) and an explicit port before matching, so neither can smuggle a
  // different destination past a suffix check.
  if (!host || host.includes('@') || host.includes(':')) {
    return false
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return false
  }
  // A portal always lives on a SUBDOMAIN of a zone — the bare zone itself is not a portal, and
  // requiring the dot is what stops `evilbitrix24.ru` from matching by suffix.
  return allowedZones(env).some(zone => host.endsWith(`.${zone}`))
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
