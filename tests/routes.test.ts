import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '~/utils/routes'

describe('isPublicRoute', () => {
  it('treats the landing root as public', () => {
    expect(isPublicRoute('/')).toBe(true)
    expect(isPublicRoute('//')).toBe(true)
    expect(isPublicRoute('')).toBe(true)
  })

  it('treats the privacy policy as public', () => {
    // The Market listing links here, so it is opened without a portal. Missing from the list, the
    // global middleware loads the ~300 KB frame SDK on it and runs a handshake that cannot succeed.
    expect(isPublicRoute('/privacy')).toBe(true)
    expect(isPublicRoute('/privacy/')).toBe(true)
  })

  it('treats in-portal pages as non-public', () => {
    expect(isPublicRoute('/app')).toBe(false)
    expect(isPublicRoute('/install')).toBe(false)
    expect(isPublicRoute('/handler/uf.smart-link')).toBe(false)
    expect(isPublicRoute('/slider/app-options')).toBe(false)
    expect(isPublicRoute('/slider/feedback')).toBe(false)
  })

  it('is not fooled by a trailing slash on an in-portal route', () => {
    expect(isPublicRoute('/app/')).toBe(false)
  })

  it('does not match a route that merely starts with a public one', () => {
    expect(isPublicRoute('/privacy-policy')).toBe(false)
    expect(isPublicRoute('/privacyfoo')).toBe(false)
  })
})
