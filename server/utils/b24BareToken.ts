import { isSafeB24Domain, normaliseHost, B24RestError, REST_TIMEOUT_MS, type RestCall } from './b24Rest'

// Live bare-token REST transport. The reference (ai-price-import) uses the b24jssdk SDK
// (makeBareTokenSdkCall); this app is on b24jssdk 0.4.x, so for the single frame-token
// verification call we use a guarded raw fetch instead (SSRF host check + timeout). A frame
// token has no server-side refresh, so any auth error means the token was rejected.
// Thin I/O edge — not unit-tested; the verification logic (frameVerify) is DI-tested.

/** Largest response body we will buffer. A `profile` reply is a couple of KB. */
export const MAX_RESPONSE_BYTES = 256 * 1024

/**
 * Read a JSON body with a hard byte cap, returning null on anything unparseable.
 *
 * `res.json()` buffers whatever the peer sends, and the peer here is a host named by the client
 * (guarded to Bitrix24 zones, but still not ours). A multi-gigabyte trickle inside the request
 * timeout would grow the process until it died, so stop reading once the cap is passed.
 */
async function readJsonCapped(res: { body?: unknown, json: () => Promise<unknown> }): Promise<unknown> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined
  if (!body || typeof body.getReader !== 'function') {
    // No stream to meter (e.g. a test double) — fall back to the plain parse.
    return res.json().catch(() => null)
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        return null // over the cap: treat as an unusable reply rather than buffering more
      }
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(new TextDecoder().decode(concatChunks(chunks, size)))
  } catch {
    return null
  }
}

function concatChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** Build a REST caller bound to one portal, authenticated with a bare frame access token. */
export function makeBareTokenCall(domain: string, accessToken: string): RestCall {
  return async (method, params = {}) => {
    if (!isSafeB24Domain(domain)) {
      throw new B24RestError('unsafe_domain', domain, 400)
    }
    const url = `https://${normaliseHost(domain)}/rest/${method}.json`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, auth: accessToken }),
        signal: controller.signal,
        // Do not follow redirects: `res.ok` would then describe the FINAL response, so a host that
        // bounces an unknown path to a 200 page would read as a successful REST call.
        redirect: 'manual'
      })
      const json = (await readJsonCapped(res)) as
        | { result?: unknown, error?: string, error_description?: string }
        | null
      if (!res.ok || json?.error) {
        // Space (not underscore) before the status so isAuthRejection's \b401\b/\b403\b
        // still classifies a bodyless 401/403 as an auth rejection.
        throw new B24RestError(json?.error ?? `http ${res.status}`, json?.error_description ?? '', res.status)
      }
      // Demand a POSITIVE success signal, never merely "did not look like an error".
      //
      // This call is what PROVES a token controls a portal, and the domain it runs against comes
      // from the client. Accepting any 2xx would let an unrelated host inside the Bitrix24 zones —
      // one that answers an unknown path with an HTML page, or whose body is unparseable, or over
      // the read cap — count as a verified portal: `json` would be null and this would resolve
      // `undefined`, which the caller reads as success.
      if (!json || typeof json !== 'object' || !('result' in json)) {
        throw new B24RestError('malformed_rest_response', `no result envelope from ${normaliseHost(domain)}`, res.status)
      }
      return json.result
    } finally {
      clearTimeout(timer)
    }
  }
}
