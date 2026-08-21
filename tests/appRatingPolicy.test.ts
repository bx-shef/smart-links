import { describe, it, expect } from 'vitest'
import {
  shouldPrompt,
  RATING_MIN_INSTALL_AGE_DAYS,
  RATING_REPROMPT_DAYS,
  type AppRatingState
} from '~~/server/utils/appRatingPolicy'

const NOW = new Date('2026-07-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)
// An installation comfortably past the minimum age — the default for cases not about the gate.
const OLD_INSTALL = { installedAt: daysAgo(30) }

describe('shouldPrompt', () => {
  it('prompts when there is no row yet', () => {
    expect(shouldPrompt(null, NOW, OLD_INSTALL)).toBe(true)
  })

  it('never prompts a confirmed review', () => {
    const s: AppRatingState = { promptedAt: daysAgo(30), openedAt: null, reviewed: true }
    expect(shouldPrompt(s, NOW, OLD_INSTALL)).toBe(false)
  })

  it('suppresses while opened_at is set (awaiting manual verification)', () => {
    const s: AppRatingState = { promptedAt: daysAgo(30), openedAt: daysAgo(10), reviewed: false }
    expect(shouldPrompt(s, NOW, OLD_INSTALL)).toBe(false)
  })

  it('reviewed wins over opened_at', () => {
    const s: AppRatingState = { promptedAt: null, openedAt: daysAgo(1), reviewed: true }
    expect(shouldPrompt(s, NOW, OLD_INSTALL)).toBe(false)
  })

  it('prompts when a row exists but was never shown', () => {
    expect(shouldPrompt({ promptedAt: null, openedAt: null, reviewed: false }, NOW, OLD_INSTALL)).toBe(true)
  })

  it('throttles within the reprompt window and re-prompts after it', () => {
    expect(shouldPrompt({ promptedAt: daysAgo(RATING_REPROMPT_DAYS - 1), openedAt: null, reviewed: false }, NOW, OLD_INSTALL)).toBe(false)
    expect(shouldPrompt({ promptedAt: daysAgo(RATING_REPROMPT_DAYS), openedAt: null, reviewed: false }, NOW, OLD_INSTALL)).toBe(true)
  })

  it('respects a custom repromptDays', () => {
    const s: AppRatingState = { promptedAt: daysAgo(5), openedAt: null, reviewed: false }
    expect(shouldPrompt(s, NOW, { ...OLD_INSTALL, repromptDays: 7 })).toBe(false)
    expect(shouldPrompt(s, NOW, { ...OLD_INSTALL, repromptDays: 4 })).toBe(true)
  })
})

describe('install-age gate (reference #380/#397)', () => {
  it('a fresh install is not prompted, even with no row at all', () => {
    // The exact defect this closes: a portal that installed today was asked on first open —
    // and the single click «Оценить» silences the prompt until manual verification.
    expect(shouldPrompt(null, NOW, { installedAt: daysAgo(RATING_MIN_INSTALL_AGE_DAYS - 1) })).toBe(false)
    expect(shouldPrompt(null, NOW, { installedAt: NOW })).toBe(false)
  })

  it('prompts once the installation is old enough', () => {
    expect(shouldPrompt(null, NOW, { installedAt: daysAgo(RATING_MIN_INSTALL_AGE_DAYS) })).toBe(true)
  })

  it('unknown install age reads as «too early», not «go ahead»', () => {
    // Asymmetric cost: an early prompt burns the one attempt; a late one costs days.
    expect(shouldPrompt(null, NOW)).toBe(false)
    expect(shouldPrompt(null, NOW, { installedAt: null })).toBe(false)
    expect(shouldPrompt({ promptedAt: null, openedAt: null, reviewed: false }, NOW, {})).toBe(false)
  })

  it('the gate applies to re-prompts too, not only the first one', () => {
    const s: AppRatingState = { promptedAt: daysAgo(RATING_REPROMPT_DAYS + 5), openedAt: null, reviewed: false }
    expect(shouldPrompt(s, NOW, { installedAt: daysAgo(1) })).toBe(false)
  })

  it('respects a custom minInstallAgeDays', () => {
    expect(shouldPrompt(null, NOW, { installedAt: daysAgo(2), minInstallAgeDays: 2 })).toBe(true)
    expect(shouldPrompt(null, NOW, { installedAt: daysAgo(2), minInstallAgeDays: 3 })).toBe(false)
  })

  it('the two four-day constants are independent by design', () => {
    // «не чаще раза в N дней» and «не раньше N суток от установки» mean different things; equal
    // values today are a coincidence. The named import above is the guard against merging them.
    expect(RATING_MIN_INSTALL_AGE_DAYS).toBeGreaterThan(0)
    expect(RATING_REPROMPT_DAYS).toBeGreaterThan(0)
  })
})
