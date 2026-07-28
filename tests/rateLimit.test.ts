import { describe, it, expect } from 'vitest'
import { createRateLimiter, rateLimitDecide, type RateLimitEntry } from '~~/server/utils/rateLimit'

const T0 = 1_000_000

describe('rateLimitDecide', () => {
  it('opens a window on the first request', () => {
    const d = rateLimitDecide(undefined, T0, 3, 60_000)
    expect(d.allowed).toBe(true)
    expect(d.entry).toEqual({ count: 1, resetAt: T0 + 60_000 })
  })

  it('allows exactly `max` requests, then blocks', () => {
    let entry: RateLimitEntry | undefined
    const results: boolean[] = []
    for (let i = 0; i < 5; i++) {
      const d = rateLimitDecide(entry, T0, 3, 60_000)
      entry = d.entry
      results.push(d.allowed)
    }
    expect(results).toEqual([true, true, true, false, false])
  })

  it('keeps the original window while blocking — a blocked retry must not extend the ban', () => {
    const entry: RateLimitEntry = { count: 99, resetAt: T0 + 10_000 }
    const d = rateLimitDecide(entry, T0 + 5_000, 3, 60_000)
    expect(d.allowed).toBe(false)
    expect(d.entry.resetAt).toBe(T0 + 10_000)
  })

  it('starts a fresh window once the old one has elapsed', () => {
    const entry: RateLimitEntry = { count: 99, resetAt: T0 + 10_000 }
    const d = rateLimitDecide(entry, T0 + 10_000, 3, 60_000)
    expect(d.allowed).toBe(true)
    expect(d.entry).toEqual({ count: 1, resetAt: T0 + 10_000 + 60_000 })
  })

  it('reports a Retry-After of at least one second', () => {
    const entry: RateLimitEntry = { count: 99, resetAt: T0 + 100 }
    expect(rateLimitDecide(entry, T0, 3, 60_000).retryAfterSec).toBe(1)
    expect(rateLimitDecide({ count: 99, resetAt: T0 + 30_000 }, T0, 3, 60_000).retryAfterSec).toBe(30)
  })
})

describe('createRateLimiter', () => {
  it('counts each key independently', () => {
    const l = createRateLimiter(2, 60_000)
    expect(l.hit('a', T0).allowed).toBe(true)
    expect(l.hit('a', T0).allowed).toBe(true)
    expect(l.hit('a', T0).allowed).toBe(false)
    expect(l.hit('b', T0).allowed).toBe(true)
  })

  it('lets a key back in after its window elapses', () => {
    const l = createRateLimiter(1, 60_000)
    expect(l.hit('a', T0).allowed).toBe(true)
    expect(l.hit('a', T0 + 59_999).allowed).toBe(false)
    expect(l.hit('a', T0 + 60_000).allowed).toBe(true)
  })

  it('bounds memory under a key spray instead of growing without limit', () => {
    const l = createRateLimiter(5, 60_000, 10)
    for (let i = 0; i < 500; i++) l.hit(`ip-${i}`, T0)
    expect(l.size()).toBeLessThanOrEqual(11)
  })

  it('sweeps expired keys before resorting to a clear', () => {
    const l = createRateLimiter(5, 1_000, 10)
    for (let i = 0; i < 10; i++) l.hit(`old-${i}`, T0)
    // Every earlier window has elapsed, so the sweep alone gets back under the cap.
    l.hit('new', T0 + 2_000)
    expect(l.size()).toBe(1)
  })
})
