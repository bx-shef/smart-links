import { isSafeB24Domain, normaliseHost, B24RestError, REST_TIMEOUT_MS, type RestCall } from './b24Rest'

// Live bare-token REST transport. The reference (ai-price-import) uses the b24jssdk SDK
// (makeBareTokenSdkCall); this app is on b24jssdk 0.4.x, so for the single frame-token
// verification call we use a guarded raw fetch instead (SSRF host check + timeout). A frame
// token has no server-side refresh, so any auth error means the token was rejected.
// Thin I/O edge — not unit-tested; the verification logic (frameVerify) is DI-tested.

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
        signal: controller.signal
      })
      const json = (await res.json().catch(() => null)) as
        | { result?: unknown, error?: string, error_description?: string }
        | null
      if (!res.ok || json?.error) {
        // Space (not underscore) before the status so isAuthRejection's \b401\b/\b403\b
        // still classifies a bodyless 401/403 as an auth rejection.
        throw new B24RestError(json?.error ?? `http ${res.status}`, json?.error_description ?? '', res.status)
      }
      return json?.result
    } finally {
      clearTimeout(timer)
    }
  }
}
