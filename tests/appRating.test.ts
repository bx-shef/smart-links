import { describe, it, expect } from 'vitest'
import { shouldPromptRating, marketDetailPath, type AppRatingState } from '~/utils/appRating'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

describe('shouldPromptRating', () => {
  it('prompts for a fresh (empty) state', () => {
    expect(shouldPromptRating({}, { now: NOW })).toBe(true)
  })

  it('never prompts once reviewed', () => {
    const state: AppRatingState = { reviewed: true, promptedAt: NOW - 100 * DAY }
    expect(shouldPromptRating(state, { now: NOW })).toBe(false)
  })

  it('stays quiet within the reprompt window', () => {
    expect(shouldPromptRating({ promptedAt: NOW - 2 * DAY }, { now: NOW })).toBe(false)
  })

  it('prompts again after the reprompt window', () => {
    expect(shouldPromptRating({ promptedAt: NOW - 5 * DAY }, { now: NOW })).toBe(true)
  })

  it('respects a custom repromptDays', () => {
    expect(shouldPromptRating({ promptedAt: NOW - 5 * DAY }, { now: NOW, repromptDays: 7 })).toBe(false)
  })

  it('stays quiet for the opened-quiet window after opening the Market', () => {
    expect(shouldPromptRating({ openedAt: NOW - 3 * DAY }, { now: NOW })).toBe(false)
  })

  it('prompts again after the opened-quiet window', () => {
    expect(shouldPromptRating({ openedAt: NOW - 40 * DAY }, { now: NOW })).toBe(true)
  })
})

describe('marketDetailPath', () => {
  it('returns null for empty / blank / undefined codes (feature off)', () => {
    expect(marketDetailPath('')).toBeNull()
    expect(marketDetailPath('   ')).toBeNull()
    expect(marketDetailPath(undefined)).toBeNull()
    expect(marketDetailPath(null)).toBeNull()
  })

  it('builds the detail path for a code and trims it', () => {
    expect(marketDetailPath('shef.smartlink')).toBe('/marketplace/detail/shef.smartlink/')
    expect(marketDetailPath('  shef.smartlink  ')).toBe('/marketplace/detail/shef.smartlink/')
  })
})
