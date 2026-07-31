import { describe, it, expect, vi } from 'vitest'
import {
  EDGE_MAX_BODY_BYTES,
  buildSecurityHeaders,
  clientKey,
  contentSecurityPolicy,
  edgeBodyGuard,
  edgeSecurityEnabled,
  edgeTrustXff,
  normalisePathname,
  rateLimitKey
} from '~~/server/utils/edgeSecurity'

describe('edgeSecurityEnabled', () => {
  it('is off unless explicitly enabled', () => {
    expect(edgeSecurityEnabled({})).toBe(false)
    expect(edgeSecurityEnabled({ APP_EDGE_SECURITY: '' })).toBe(false)
    expect(edgeSecurityEnabled({ APP_EDGE_SECURITY: '0' })).toBe(false)
    expect(edgeSecurityEnabled({ APP_EDGE_SECURITY: 'no' })).toBe(false)
  })

  it('accepts 1/true in any case, with surrounding space', () => {
    expect(edgeSecurityEnabled({ APP_EDGE_SECURITY: '1' })).toBe(true)
    expect(edgeSecurityEnabled({ APP_EDGE_SECURITY: ' TRUE ' })).toBe(true)
  })
})

describe('edgeTrustXff', () => {
  it('defaults off — the bypass-safe direction', () => {
    expect(edgeTrustXff({})).toBe(false)
    expect(edgeTrustXff({ APP_EDGE_TRUST_XFF: '1' })).toBe(true)
  })
})

describe('clientKey', () => {
  it('takes the LAST forwarded hop (the one a trusted proxy appends)', () => {
    expect(clientKey('1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.1')).toBe('3.3.3.3')
  })

  it('falls back to the peer, then to a constant', () => {
    expect(clientKey(undefined, '10.0.0.1')).toBe('10.0.0.1')
    expect(clientKey('  ', '  ')).toBe('unknown')
  })
})

describe('rateLimitKey', () => {
  it('ignores a client-controlled XFF by default', () => {
    // Otherwise a client rotating the header would land in a fresh bucket on every request.
    expect(rateLimitKey(false, '9.9.9.9', '10.0.0.1')).toBe('10.0.0.1')
    expect(rateLimitKey(false, '1.1.1.1, 9.9.9.9', '10.0.0.1')).toBe('10.0.0.1')
  })

  it('trusts the last hop only when the proxy is declared trusted', () => {
    expect(rateLimitKey(true, '1.1.1.1, 9.9.9.9', '10.0.0.1')).toBe('9.9.9.9')
  })

  it('never yields an empty key', () => {
    expect(rateLimitKey(false, undefined, undefined)).toBe('unknown')
    expect(rateLimitKey(true, '  ', '  ')).toBe('unknown')
  })
})

describe('contentSecurityPolicy', () => {
  it('lets Bitrix24 portals embed every page', () => {
    for (const p of ['/', '/app', '/install', '/handler/uf.smart-link', '/slider/app-options']) {
      expect(contentSecurityPolicy(p)).toContain('frame-ancestors')
      expect(contentSecurityPolicy(p)).toContain('https://*.bitrix24.by')
    }
  })

  it('never sends the frame-busting default (that would break the portal iframe)', () => {
    expect(buildSecurityHeaders('/app')['X-Frame-Options']).toBeUndefined()
  })

  it('relaxes only the feedback slider, which embeds the B24 form loader via srcdoc', () => {
    // A srcdoc iframe inherits the embedder's CSP, so the CDN must be allowed on the page itself.
    const form = contentSecurityPolicy('/slider/feedback')
    expect(form).toContain('https://cdn-ru.bitrix24.com')
    expect(contentSecurityPolicy('/app')).not.toContain('https://cdn-ru.bitrix24.com')
  })

  it('matches the feedback path with a trailing slash or a query string', () => {
    expect(contentSecurityPolicy('/slider/feedback/')).toBe(contentSecurityPolicy('/slider/feedback'))
    expect(contentSecurityPolicy(normalisePathname('/slider/feedback?a=1#x'))).toBe(contentSecurityPolicy('/slider/feedback'))
  })
})

describe('buildSecurityHeaders', () => {
  it('carries the headers a reverse proxy would otherwise add', () => {
    const h = buildSecurityHeaders('/app')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Strict-Transport-Security']).toContain('max-age=')
    expect(h['Content-Security-Policy']).toContain('object-src \'none\'')
  })
})

describe('normalisePathname', () => {
  it('strips query and hash', () => {
    expect(normalisePathname('/a/b?x=1')).toBe('/a/b')
    expect(normalisePathname('/a/b#frag')).toBe('/a/b')
    expect(normalisePathname('/a/b?x=1#frag')).toBe('/a/b')
    expect(normalisePathname('/a/b')).toBe('/a/b')
  })
})

describe('edgeBodyGuard', () => {
  it('rejects an over-cap declared length', () => {
    expect(edgeBodyGuard(String(EDGE_MAX_BODY_BYTES + 1), undefined, EDGE_MAX_BODY_BYTES)).toBe(413)
  })

  it('allows a body at exactly the cap', () => {
    expect(edgeBodyGuard(String(EDGE_MAX_BODY_BYTES), undefined, EDGE_MAX_BODY_BYTES)).toBeNull()
  })

  it('rejects an unbounded chunked body with no declared length', () => {
    expect(edgeBodyGuard(undefined, 'chunked', EDGE_MAX_BODY_BYTES)).toBe(411)
    expect(edgeBodyGuard(undefined, 'gzip, Chunked', EDGE_MAX_BODY_BYTES)).toBe(411)
  })

  it('leaves bodyless requests alone', () => {
    expect(edgeBodyGuard(undefined, undefined, EDGE_MAX_BODY_BYTES)).toBeNull()
    expect(edgeBodyGuard('0', undefined, EDGE_MAX_BODY_BYTES)).toBeNull()
  })

  it('treats a malformed Content-Length as absent, so it cannot smuggle a chunked body', () => {
    expect(edgeBodyGuard('abc', 'chunked', EDGE_MAX_BODY_BYTES)).toBe(411)
    expect(edgeBodyGuard('-5', 'chunked', EDGE_MAX_BODY_BYTES)).toBe(411)
    expect(edgeBodyGuard('  ', 'chunked', EDGE_MAX_BODY_BYTES)).toBe(411)
    // …but on its own a malformed length is not grounds to reject a bodyless request.
    expect(edgeBodyGuard('abc', undefined, EDGE_MAX_BODY_BYTES)).toBeNull()
  })
})

describe('CSP берёт зоны из того же списка, что SSRF-гард', () => {
  it('зона из B24_EXTRA_ZONES попадает в frame-ancestors', async () => {
    // The regression this guards: the CSP was once derived from the STATIC zone list only, so a
    // portal in an env-added zone passed server-side verification while the browser blocked the
    // iframe on a frame-ancestors that had never heard of the zone. Fresh module import, because
    // the host list is memoised per process.
    vi.stubEnv('B24_EXTRA_ZONES', 'bitrix24.test')
    vi.resetModules()
    try {
      const mod = await import('~~/server/utils/edgeSecurity')
      const csp = mod.contentSecurityPolicy('/handler/uf.smart-link')
      expect(csp).toContain('https://*.bitrix24.test')
      expect(csp).toContain('https://*.bitrix24.by')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

