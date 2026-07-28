import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '~/utils/routes'

describe('isPublicRoute', () => {
  it('treats the landing root as public', () => {
    expect(isPublicRoute('/')).toBe(true)
    expect(isPublicRoute('//')).toBe(true)
    expect(isPublicRoute('')).toBe(true)
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
})
