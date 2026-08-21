import { allowedZones } from './b24Rest'

// Edge protections the app applies to ITSELF when it runs directly internet-facing with no reverse
// proxy in front — the Bitrix24 Vibecode "Black Hole" target, where a single Nitro process answers
// the platform tunnel on :3000. There is no nginx there to supply CSP / security headers / HSTS or a
// `client_max_body_size` backstop, so the app supplies them.
//
// Gated behind APP_EDGE_SECURITY so this is a NO-OP by default: put a reverse proxy in front later
// and the two would emit two CSP headers, which browsers intersect restrictively (a stricter, harder
// to debug policy than either one), and the per-IP limits would bucket every client under the shared
// proxy IP. Pure + DI on env → unit-tested. See docs/DEPLOY_VIBECODE.md.

/** True only when this process is directly internet-facing and must self-apply edge controls. */
export function edgeSecurityEnabled(env: Record<string, string | undefined>): boolean {
  const v = (env.APP_EDGE_SECURITY ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

/**
 * Escape hatch: set APP_EDGE_TRUST_XFF=1 ONLY after live-verifying that the platform ingress is a
 * trusted proxy that APPENDS the real client as the last X-Forwarded-For hop. Then per-IP limits key
 * on that hop instead of `socket.remoteAddress` — which, behind such a tunnel, is one shared gateway
 * address, collapsing every client into a single bucket.
 *
 * Default OFF is the bypass-safe direction: the real TCP peer cannot be spoofed, and the worst case
 * (shared peer) degrades the per-IP limit into a GLOBAL cap — reduced availability, never a bypass.
 */
export function edgeTrustXff(env: Record<string, string | undefined>): boolean {
  const v = (env.APP_EDGE_TRUST_XFF ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

/** Last X-Forwarded-For hop (the one a trusted proxy appends), else the raw peer address. */
export function clientKey(xff: string | undefined, remote: string | undefined): string {
  const hops = (xff ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return hops[hops.length - 1] || (remote ?? '').trim() || 'unknown'
}

/**
 * Per-IP rate-limit key. X-Forwarded-For is trusted ONLY when APP_EDGE_TRUST_XFF says a verified
 * trusted proxy sits in front; otherwise the key is the real TCP peer.
 *
 * The default direction matters: the header is client-controlled unless something upstream
 * overwrites it, so keying on it by default would let one client rotate `X-Forwarded-For` per
 * request and land in a fresh bucket every time — the limit would be bypassed by anyone who
 * bothered. Keying on the peer cannot be spoofed; the worst case (every client behind one shared
 * gateway address) degrades the per-IP limit into a global cap, which costs availability, not safety.
 */
export function rateLimitKey(trustXff: boolean, xff: string | undefined, remote: string | undefined): string {
  if (trustXff) return clientKey(xff, remote)
  return (remote ?? '').trim() || 'unknown'
}

// Bitrix24 cloud domains the app must interoperate with: the portal embeds our pages in an iframe
// (frame-ancestors) and the frame SDK talks to the portal REST endpoint (connect-src).
//
// Derived from the SSRF allowlist — the WHOLE allowlist, B24_EXTRA_ZONES included. This was a
// static `B24_ZONES.map(...)` once, which recreated the very drift its comment warned about, one
// layer up: a zone added via the env var passed server-side verification while the browser still
// blocked the iframe on a frame-ancestors list that had never heard of it. An outage that looks
// configured-away. Computed lazily (env is read at first request, not at import) and memoised —
// the zone set cannot change without a process restart.
let b24HostsCache: string | null = null
function b24Hosts(): string {
  if (b24HostsCache === null) {
    b24HostsCache = allowedZones().map(zone => `https://*.${zone}`).join(' ')
  }
  return b24HostsCache
}

// Default page policy. `script-src 'unsafe-inline'` is required, not laziness: Nuxt inlines the
// prerendered `window.__NUXT__` payload, and the policy is not hash-based.
// X-Frame-Options is deliberately NOT sent — it would break the portal iframe outright, and it has
// no wildcard form; frame-ancestors is the mechanism that actually scopes embedding.
function pageCsp(): string {
  const hosts = b24Hosts()
  return 'default-src \'self\'; img-src \'self\' data: https:; style-src \'self\' \'unsafe-inline\'; '
    + 'script-src \'self\' \'unsafe-inline\'; font-src \'self\' data:; '
    + `connect-src 'self' ${hosts}; `
    + `frame-ancestors 'self' ${hosts}; `
    + 'base-uri \'self\'; object-src \'none\''
}

// The feedback slider builds a `srcdoc` iframe that pulls the Bitrix24 CRM-form loader from a
// Bitrix CDN. A srcdoc document INHERITS the embedder's CSP, so the relaxed policy has to be served
// on the embedding page itself — scoping it to that one path keeps every other page on PAGE_CSP.
function formCsp(): string {
  const hosts = b24Hosts()
  return `default-src 'self' ${hosts}; `
    + `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${hosts} https://cdn-ru.bitrix24.com https://cdn.bitrix24.com; `
    + `style-src 'self' 'unsafe-inline' ${hosts}; `
    + 'img-src \'self\' data: https:; font-src \'self\' data: https:; '
    + `connect-src 'self' ${hosts} https://cdn-ru.bitrix24.com https://cdn.bitrix24.com; `
    + `frame-src 'self' ${hosts}; `
    + `frame-ancestors 'self' ${hosts}; `
    + 'base-uri \'self\''
}

const HSTS = 'max-age=63072000; includeSubDomains'

/** The path that embeds the B24 CRM form needs the relaxed policy; everything else gets the page policy. */
export function contentSecurityPolicy(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/slider/feedback' ? formCsp() : pageCsp()
}

/**
 * Security headers to attach to a response for `pathname`. HSTS is safe to send even over plain
 * HTTP (browsers ignore it there), and the Vibecode target serves HTTPS.
 */
export function buildSecurityHeaders(pathname: string): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(pathname),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': HSTS
  }
}

/** Strip query/hash so `/slider/feedback?x=1` still matches the form path. */
export function normalisePathname(path: string): string {
  const q = path.indexOf('?')
  const base = q === -1 ? path : path.slice(0, q)
  const h = base.indexOf('#')
  return h === -1 ? base : base.slice(0, h)
}

// Global request-body cap when edge security is on. This app accepts no uploads — the largest legit
// body is a few-byte JSON action for /api/app-rating — so the cap is deliberately tight.
export const EDGE_MAX_BODY_BYTES = 256 * 1024

/**
 * Global edge body guard, applied to EVERY request when edge security is on — the equivalent of
 * nginx `client_max_body_size` for a process with no nginx. Returns the status to reject with, or null:
 *  - 413 when the declared Content-Length exceeds `max`;
 *  - 411 when the body is chunked with NO Content-Length — such a body would buffer unbounded
 *    (h3's `readBody` has no size limit), so it must be rejected BEFORE any handler reads it.
 * A request with neither header (a bodyless / `Content-Length: 0` POST) is NOT rejected, so the
 * missing-length defense stays safe-by-default for routes added later.
 */
export function edgeBodyGuard(contentLength: string | undefined, transferEncoding: string | undefined, max: number): 411 | 413 | null {
  const raw = (contentLength ?? '').trim()
  const parsed = raw === '' ? Number.NaN : Number(raw)
  // A malformed Content-Length counts as ABSENT, not as a declared size — otherwise `Content-Length:
  // abc` would satisfy the "has a length" test below and smuggle an unbounded chunked body past the
  // guard. (Node's parser rejects such a header itself; this keeps the pure core sound on its own.)
  const declared = Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  if (declared !== null && declared > max) return 413
  const chunked = (transferEncoding ?? '').toLowerCase().includes('chunked')
  if (chunked && declared === null) return 411
  return null
}

// ── Request-time limits: the no-nginx analog of client_header_timeout / client_body_timeout ──────
// (ported from the reference app, its #322)
//
// Without a reverse proxy only Node's defaults apply: requestTimeout 300s (total), headersTimeout
// 60s — and NO idle bound, so a drip-feed body (1 byte / 30s) holds a socket for the full 300s at
// near-zero cost to the attacker (slowloris by body). A hundred such POSTs is a hundred sockets
// pinned for five minutes each on the single process serving every portal.
//
// The compensation mirrors nginx semantics, applied to the Node http.Server when APP_EDGE_SECURITY=1:
//  - socket idle (server.timeout) ← client_body_timeout: cuts a connection that sent NOTHING for
//    the window. An honest client on a bad channel keeps trickling bytes and is never idle-cut.
//    ⚠ `server.timeout` counts inactivity in BOTH directions, while the client-idle rule applies
//    only WHILE RECEIVING. Our slowest handlers legitimately wait on an outbound REST call to the
//    portal (frame-token verification) with nothing on the wire — so Node's default
//    destroy-on-timeout is replaced by our own 'timeout' listener (attaching one disables the
//    default destroy) that kills the socket ONLY while the current request is still being received
//    (`shouldCutOnIdle`); after the body is fully in, the wait is the server's own slowness and is
//    bounded by the handler's budgets, not by the client-idle rule.
//  - requestTimeout stays as the TOTAL ceiling (Node's own default, made explicit + tunable): even
//    a never-idle drip is bounded. ⚠ Node enforces it on a periodic connections check, so the cut
//    lands up to a couple of intervals past the deadline — the bound is «total + minutes», not exact
//    (the reference verified this live on the built server).
//  - headersTimeout ← client_header_timeout.
// Behind a proxy (flag off, the default) none of this is applied — the proxy already owns these
// bounds, and a second layer here would only add a knob that can silently disagree with its config.
const EDGE_TIMEOUT_DEFAULTS = { socketIdleMs: 60_000, headersTimeoutMs: 60_000, requestTimeoutMs: 300_000 }

/** Clamp an env override into a sane band: below 5s cuts honest clients mid-handshake, above 1h is
 *  no protection at all. Absent/invalid env → the default. */
function timeoutFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.max(n, 5_000), 3_600_000)
}

/** Resolved edge timeouts (ms) from env, with nginx-parity defaults. Pure → unit-tested. */
export function edgeTimeouts(env: Record<string, string | undefined>): { socketIdleMs: number, headersTimeoutMs: number, requestTimeoutMs: number } {
  return {
    socketIdleMs: timeoutFromEnv(env.EDGE_SOCKET_IDLE_MS, EDGE_TIMEOUT_DEFAULTS.socketIdleMs),
    headersTimeoutMs: timeoutFromEnv(env.EDGE_HEADERS_TIMEOUT_MS, EDGE_TIMEOUT_DEFAULTS.headersTimeoutMs),
    requestTimeoutMs: timeoutFromEnv(env.EDGE_REQUEST_TIMEOUT_MS, EDGE_TIMEOUT_DEFAULTS.requestTimeoutMs)
  }
}

/** Minimal shape of node:http Server this module needs (keeps the util import-free and testable). */
export interface TimeoutServer {
  timeout: number
  headersTimeout: number
  requestTimeout: number
  setTimeout: (ms: number, listener?: (socket: IdleSocket) => void) => unknown
  on: (event: 'request', listener: (req: IncomingRequest) => void) => unknown
}

/** The slivers of net.Socket / http.IncomingMessage this module reads (testable with plain objects). */
export interface IdleSocket { destroy: () => void }
export interface IncomingRequest {
  socket: IdleSocket & { edgeReceiving?: boolean }
  headers: Record<string, string | string[] | undefined>
  readableEnded?: boolean
  on: (event: 'end' | 'close', listener: () => void) => unknown
}

/** True when an idle socket must be destroyed: the request is still BEING RECEIVED (headers/body in
 *  flight — the slowloris window). Once the body is fully in, client silence is normal (the client
 *  is waiting for the handler, e.g. an outbound frame-token check) and must not be cut. Undefined
 *  marker (no request seen on this socket yet — pre-request idle) also cuts: nothing legit idles
 *  before sending a request. */
export function shouldCutOnIdle(receiving: boolean | undefined): boolean {
  return receiving !== false
}

/** Apply the resolved timeouts to a live http.Server. The plugin gates the whole call to once (the
 *  listeners must not stack). `setTimeout` with OUR listener replaces Node's default destroy-on-idle:
 *  we cut only sockets whose current request is still being received (see the module rationale). */
export function applyEdgeTimeouts(server: TimeoutServer, t: ReturnType<typeof edgeTimeouts>): void {
  server.on('request', (req) => {
    req.socket.edgeReceiving = true
    const done = () => {
      req.socket.edgeReceiving = false
    }
    // A bodyless request (no Content-Length, no Transfer-Encoding — the typical GET) is fully
    // received the moment its headers are in. Waiting for the stream's 'end' would hang the marker:
    // 'end' only fires once somebody READS the (empty) stream, and handlers don't read GET bodies.
    if (req.readableEnded || (!req.headers['content-length'] && !req.headers['transfer-encoding'])) {
      done()
    } else {
      req.on('end', done) // body fully received → handler time, no idle cut
      req.on('close', done) // aborted/errored request must not leave the socket marked forever
    }
  })
  server.setTimeout(t.socketIdleMs, (socket: IdleSocket & { edgeReceiving?: boolean }) => {
    if (shouldCutOnIdle(socket.edgeReceiving)) {
      socket.destroy()
    }
  })
  server.headersTimeout = t.headersTimeoutMs
  server.requestTimeout = t.requestTimeoutMs
}
