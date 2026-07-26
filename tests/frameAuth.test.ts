import { describe, it, expect } from 'vitest'
import { normaliseHost, isSafeB24Domain, isAuthRejection } from '~~/server/utils/b24Rest'
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
    // Anchored on `bitrix24.<tld>$`, so a look-alike suffix is rejected.
    expect(isSafeB24Domain('company.bitrix24.by.evil.com')).toBe(false)
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
