// Pure decision core for the in-portal «оцените приложение» prompt (no I/O → unit-tested).
// State lives in the app_rating table (one row per portal, keyed by portal_key). Rules mirror
// the reference (ai-price-import):
//   • reviewed === true → NEVER prompt again (a real Market review is confirmed).
//   • opened_at is set  → the user already clicked «Оценить»; suppress until an owner manually
//                         verifies the review (owner clears opened_at to re-enable).
//   • otherwise         → show, but no more than once per RATING_REPROMPT_DAYS (throttled by
//                         prompted_at). So it surfaces «раз в несколько дней», not on every open.

/** Days between prompts and the manual-verification window (kept as one constant so both stay
 *  in lockstep). */
export const RATING_REPROMPT_DAYS = 4

const DAY_MS = 24 * 60 * 60 * 1000

/** Row shape from app_rating (nulls when the portal has no row yet). */
export interface AppRatingState {
  promptedAt: Date | null
  openedAt: Date | null
  reviewed: boolean
}

export interface ShouldPromptOptions {
  /** Override the re-prompt interval (days). Defaults to RATING_REPROMPT_DAYS. */
  repromptDays?: number
}

/**
 * Decide whether to show the rating modal now. `now` is injected so the decision is deterministic
 * and testable. A missing row (never prompted) → show.
 */
export function shouldPrompt(state: AppRatingState | null, now: Date, opts: ShouldPromptOptions = {}): boolean {
  if (!state) {
    return true // no row yet → first-ever prompt
  }
  if (state.reviewed) {
    return false // confirmed review → done forever
  }
  if (state.openedAt) {
    return false // clicked «Оценить» → wait for manual verification
  }
  if (!state.promptedAt) {
    return true // row exists but was never actually shown
  }
  const intervalMs = (opts.repromptDays ?? RATING_REPROMPT_DAYS) * DAY_MS
  return now.getTime() - state.promptedAt.getTime() >= intervalMs
}
