import { describe, it, expect } from 'vitest'
import { B24_ZONES, normaliseHost, isSafeB24Domain, isAuthRejection } from '~~/server/utils/b24Rest'
import { extractFrameAuth } from '~~/server/utils/frameAuth'

describe('normaliseHost', () => {
  it('strips scheme/path and lower-cases', () => {
    expect(normaliseHost('https://Example.Bitrix24.BY/rest/x')).toBe('example.bitrix24.by')
    expect(normaliseHost('  portal.bitrix24.com  ')).toBe('portal.bitrix24.com')
  })
})

describe('isSafeB24Domain', () => {
  it('accepts Bitrix24 cloud hosts', () => {
    expect(isSafeB24Domain('company.bitrix24.by')).toBe(true)
    expect(isSafeB24Domain('company.bitrix24.com')).toBe(true)
    expect(isSafeB24Domain('https://sub.company.bitrix24.ru/')).toBe(true)
  })

  it('rejects non-Bitrix24 / unsafe hosts (SSRF guard)', () => {
    expect(isSafeB24Domain('evil.com')).toBe(false)
    expect(isSafeB24Domain('company.bitrix24.by:8080')).toBe(false)
    expect(isSafeB24Domain('user@company.bitrix24.by')).toBe(false)
    expect(isSafeB24Domain('bitrix24.by')).toBe(false)
    expect(isSafeB24Domain('')).toBe(false)
    // Matched on `.<zone>` suffix, so a look-alike suffix is rejected.
    expect(isSafeB24Domain('company.bitrix24.by.evil.com')).toBe(false)
    // …and so is a look-alike PREFIX, which a bare suffix check would let through.
    expect(isSafeB24Domain('evilbitrix24.ru')).toBe(false)
  })

  it('rejects a zone Bitrix does not own (a free TLD anyone can register)', () => {
    // The host would answer our own verification call, so an open `bitrix24.<any tld>` pattern
    // would let an attacker mint arbitrary portal keys.
    expect(isSafeB24Domain('a.bitrix24.top')).toBe(false)
    expect(isSafeB24Domain('a.bitrix24.shop')).toBe(false)
    expect(isSafeB24Domain('a.bitrix24.xyz')).toBe(false)
  })

  it('accepts a zone added through B24_EXTRA_ZONES (escape hatch for a zone we missed)', () => {
    const env = { B24_EXTRA_ZONES: 'bitrix24.example, bitrix24.test' }
    expect(isSafeB24Domain('company.bitrix24.example', env)).toBe(true)
    expect(isSafeB24Domain('company.bitrix24.test', env)).toBe(true)
    expect(isSafeB24Domain('company.bitrix24.other', env)).toBe(false)
    // The extra zone still has to be a real subdomain, and still cannot carry a port/userinfo.
    expect(isSafeB24Domain('bitrix24.example', env)).toBe(false)
    expect(isSafeB24Domain('company.bitrix24.example:8080', env)).toBe(false)
  })

  it('accepts every documented zone as a portal subdomain', () => {
    for (const zone of B24_ZONES) {
      expect(isSafeB24Domain(`company.${zone}`)).toBe(true)
    }
  })
})

describe('isAuthRejection', () => {
  it('classifies auth errors as rejection', () => {
    expect(isAuthRejection(new Error('invalid_token'))).toBe(true)
    expect(isAuthRejection(new Error('HTTP 401'))).toBe(true)
    expect(isAuthRejection('access denied')).toBe(true)
  })

  it('classifies transport/network errors as non-rejection', () => {
    expect(isAuthRejection(new Error('network timeout'))).toBe(false)
    expect(isAuthRejection(new Error('http_502'))).toBe(false)
  })
})

describe('extractFrameAuth', () => {
  it('extracts a Bearer token + safe domain', () => {
    expect(extractFrameAuth({ authorization: 'Bearer abc.123', 'x-b24-domain': 'c.bitrix24.by' }))
      .toEqual({ accessToken: 'abc.123', domain: 'c.bitrix24.by' })
  })

  it('falls back to capitalized headers', () => {
    expect(extractFrameAuth({ Authorization: 'Bearer abc.123', 'X-B24-Domain': 'c.bitrix24.by' }))
      .toEqual({ accessToken: 'abc.123', domain: 'c.bitrix24.by' })
  })

  it('returns null for a non-Bearer scheme', () => {
    expect(extractFrameAuth({ authorization: 'Basic xxx', 'x-b24-domain': 'c.bitrix24.by' })).toBeNull()
  })

  it('returns null without a token or domain', () => {
    expect(extractFrameAuth({ 'x-b24-domain': 'c.bitrix24.by' })).toBeNull()
    expect(extractFrameAuth({ authorization: 'Bearer abc' })).toBeNull()
    expect(extractFrameAuth({})).toBeNull()
  })

  it('returns null for an unsafe domain (SSRF)', () => {
    expect(extractFrameAuth({ authorization: 'Bearer abc', 'x-b24-domain': 'evil.com' })).toBeNull()
  })
})
