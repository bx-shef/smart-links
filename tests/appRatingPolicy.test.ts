import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('an Invalid Date reads as «too early», not «go ahead»', () => {
    // Invalid Date is truthy and its getTime() is NaN: a young-check comparison (`diff < threshold`)
    // would fail OPEN and prompt immediately. The gate is written as «prompt only when provably
    // old enough», and the parse points null garbage out — this pins the policy half.
    expect(shouldPrompt(null, NOW, { installedAt: new Date('not a date') })).toBe(false)
  })

  it('the two four-day constants are independent by design', () => {
    // «не чаще раза в N дней» and «не раньше N суток от установки» mean different things; equal
    // values today are a coincidence. A behavioral test cannot tell the two apart while the values
    // match, so this is a SOURCE check: each constant must be defined as its own numeric literal —
    // aliasing one to the other would silently weld the two knobs together.
    const src = readFileSync(resolve(__dirname, '../server/utils/appRatingPolicy.ts'), 'utf8')
    expect(src).toMatch(/export const RATING_REPROMPT_DAYS = \d+/)
    expect(src).toMatch(/export const RATING_MIN_INSTALL_AGE_DAYS = \d+/)
    expect(RATING_MIN_INSTALL_AGE_DAYS).toBeGreaterThan(0)
    expect(RATING_REPROMPT_DAYS).toBeGreaterThan(0)
  })
})

// The policy being perfect is not enough: the route wiring has three links whose silent deletion
// leaves every suite green while the prompt dies for host-keyed portals (same rationale as the
// wiring guard in tests/loadCoalesce.test.ts).
describe('wiring: GET /api/app-rating anchors the install age', () => {
  const src = readFileSync(resolve(__dirname, '../server/api/app-rating.get.ts'), 'utf8')

  it('creates the rating row on first sighting (starts the clock for host-keyed portals)', () => {
    expect(src).toMatch(/if \(!state\) \{[\s\S]{0,600}?await touchFirstSeen\(portalKey, query\)/)
  })

  it('prefers the token created_at and falls back to first sighting', () => {
    expect(src).toMatch(/await installCreatedAt\(portalKey, query\) \?\? state\?\.firstSeenAt \?\? null/)
  })

  it('feeds the anchor into the policy decision', () => {
    expect(src).toMatch(/shouldPrompt\(state, new Date\(\), \{ installedAt \}\)/)
  })
})
