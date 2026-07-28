import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '~/utils/routes'

describe('isPublicRoute', () => {
  it('treats the landing root as public', () => {
    expect(isPublicRoute('/')).toBe(true)
    expect(isPublicRoute('//')).toBe(true)
    expect(isPublicRoute('')).toBe(true)
  })

  it('treats in-portal pages as non-public', () => {
    expect(isPublicRoute('/index.html')).toBe(false)
    expect(isPublicRoute('/install.html')).toBe(false)
    expect(isPublicRoute('/handler/uf.smart-link.html')).toBe(false)
    expect(isPublicRoute('/slider/app-options.html')).toBe(false)
  })
})
