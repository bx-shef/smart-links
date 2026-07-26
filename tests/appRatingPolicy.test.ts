import { describe, it, expect } from 'vitest'
import { shouldPrompt, RATING_REPROMPT_DAYS, type AppRatingState } from '~~/server/utils/appRatingPolicy'

const NOW = new Date('2026-07-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('shouldPrompt', () => {
  it('prompts when there is no row yet', () => {
    expect(shouldPrompt(null, NOW)).toBe(true)
  })

  it('never prompts a confirmed review', () => {
    const s: AppRatingState = { promptedAt: daysAgo(100), openedAt: null, reviewed: true }
    expect(shouldPrompt(s, NOW)).toBe(false)
  })

  it('suppresses while opened_at is set (awaiting manual verification)', () => {
    const s: AppRatingState = { promptedAt: daysAgo(100), openedAt: daysAgo(1), reviewed: false }
    expect(shouldPrompt(s, NOW)).toBe(false)
  })

  it('reviewed wins over opened_at', () => {
    const s: AppRatingState = { promptedAt: null, openedAt: daysAgo(1), reviewed: true }
    expect(shouldPrompt(s, NOW)).toBe(false)
  })

  it('prompts when a row exists but was never shown', () => {
    expect(shouldPrompt({ promptedAt: null, openedAt: null, reviewed: false }, NOW)).toBe(true)
  })

  it('throttles within the reprompt window and re-prompts after it', () => {
    expect(shouldPrompt({ promptedAt: daysAgo(RATING_REPROMPT_DAYS - 1), openedAt: null, reviewed: false }, NOW)).toBe(false)
    expect(shouldPrompt({ promptedAt: daysAgo(RATING_REPROMPT_DAYS), openedAt: null, reviewed: false }, NOW)).toBe(true)
  })

  it('respects a custom repromptDays', () => {
    const s: AppRatingState = { promptedAt: daysAgo(5), openedAt: null, reviewed: false }
    expect(shouldPrompt(s, NOW, { repromptDays: 7 })).toBe(false)
    expect(shouldPrompt(s, NOW, { repromptDays: 4 })).toBe(true)
  })
})
