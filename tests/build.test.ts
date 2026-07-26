import { describe, it, expect } from 'vitest'
import { shortSha, commitUrl, healthInfo } from '~/utils/build'

const REPO = 'https://github.com/bx-shef/smart-links'

describe('shortSha', () => {
  it('takes the first 7 chars and trims', () => {
    expect(shortSha('abcdef1234567')).toBe('abcdef1')
    expect(shortSha('  abcdef1234  ')).toBe('abcdef1')
  })

  it('returns empty for missing sha', () => {
    expect(shortSha(undefined)).toBe('')
    expect(shortSha(null)).toBe('')
    expect(shortSha('')).toBe('')
  })
})

describe('commitUrl', () => {
  it('links to the commit for a real sha', () => {
    expect(commitUrl('abc1234')).toBe(`${REPO}/commit/abc1234`)
  })

  it('links to the repo root for dev / empty sha', () => {
    expect(commitUrl('dev')).toBe(REPO)
    expect(commitUrl('')).toBe(REPO)
    expect(commitUrl(undefined)).toBe(REPO)
  })
})

describe('healthInfo', () => {
  it('reports ok with a real commit and its url', () => {
    expect(healthInfo('abc1234')).toEqual({
      status: 'ok',
      commit: 'abc1234',
      commitUrl: `${REPO}/commit/abc1234`
    })
  })

  it('falls back to dev with a null commitUrl when the sha is unknown', () => {
    expect(healthInfo(undefined)).toEqual({ status: 'ok', commit: 'dev', commitUrl: null })
    expect(healthInfo('')).toEqual({ status: 'ok', commit: 'dev', commitUrl: null })
  })
})
