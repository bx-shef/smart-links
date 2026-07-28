import { REST_TIMEOUT_MS } from './b24Rest'

// OAuth token-endpoint helpers: pure request/response shaping plus the one live POST.
// Adapted from the reference app (ai-price-import).

/**
 * Bitrix24's OAuth token endpoint — the host documented in «Автоматическое продление токенов» and
 * in the network-access requirements. (The older `oauth.bitrix.info` still answers but appears
 * nowhere in current documentation, so relying on it would be leaning on an undocumented alias.)
 *
 * The host is FIXED, never derived from client input, so unlike the REST calls this one carries no
 * SSRF surface and needs no domain allowlist.
 */
export const OAUTH_TOKEN_URL = 'https://oauth.bitrix24.tech/oauth/token/'

export interface B24TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  client_endpoint?: string
  /** Present on a genuine grant. This is the field the install-time member_id bind exists for. */
  member_id?: string
}

/** Minimal fetch-like signature, so the live call can be swapped for a fake in tests. */
export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>

/** Params for `grant_type=refresh_token`. */
export function buildRefreshParams(clientId: string, clientSecret: string, refreshToken: string): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  }
}

/** Validate and narrow a token-endpoint success payload. Throws when it is not one. */
export function parseTokenResponse(raw: unknown): B24TokenResponse {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const access = String(o.access_token ?? '')
  const refresh = String(o.refresh_token ?? '')
  if (!access || !refresh) {
    throw new Error('b24 oauth: malformed token response')
  }
  const expires = Number(o.expires_in ?? 3600)
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Number.isFinite(expires) && expires > 0 ? expires : 3600,
    client_endpoint: o.client_endpoint ? String(o.client_endpoint) : '',
    member_id: o.member_id ? String(o.member_id) : ''
  }
}

/**
 * Raw OAuth token POST → parsed JSON. Secrets ride in the request BODY, never the query string,
 * so they cannot end up in an access log. Bounded by AbortSignal so a hung OAuth server does not
 * pin the request. `fetchFn` is injected for tests.
 */
export function makeOauthRefresh(fetchFn: FetchLike, timeoutMs = REST_TIMEOUT_MS) {
  return async (params: Record<string, string>): Promise<unknown> => {
    const res = await fetchFn(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.json()
  }
}
