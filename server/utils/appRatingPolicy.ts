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

/**
 * Minimum age of the INSTALLATION before the first prompt (reference #380/#397).
 *
 * Without it a portal that installed the app and linked one record ten minutes later was already
 * asked to rate it — the person has seen the product once, and there is barely a second chance:
 * clicking «Оценить» stamps `opened_at` and the prompt goes silent until the owner verifies by
 * hand.
 *
 * ⚠ A SEPARATE constant from `RATING_REPROMPT_DAYS`, even though both are 4 today. They mean
 * different things — «не чаще раза в N дней» and «не раньше N суток от установки» — and one
 * constant for two meanings binds them forever; the coincidence is accidental.
 */
export const RATING_MIN_INSTALL_AGE_DAYS = 4

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
  /** Override the minimum install age (days). Defaults to RATING_MIN_INSTALL_AGE_DAYS. */
  minInstallAgeDays?: number
  /**
   * When this portal got the app. For an OAuth-registered portal — `portal_tokens.created_at`
   * (survives refresh and re-delivered installs: the UPSERT never touches it; uninstall deletes
   * the row, so a returning portal legitimately starts the clock anew). For a host-keyed portal
   * with no token row — the `app_rating` row's own created_at, i.e. the first time this portal was
   * SEEN by the rating route: later than the real install, which only errs in the safe direction.
   */
  installedAt?: Date | null
}

/**
 * Decide whether to show the rating modal now. `now` is injected so the decision is deterministic
 * and testable. A missing row (never prompted) → show.
 */
export function shouldPrompt(state: AppRatingState | null, now: Date, opts: ShouldPromptOptions = {}): boolean {
  // Install age gates EVERYTHING, including the first-ever prompt.
  //
  // ⚠ Unknown age reads as «too early», not «go ahead»: the cost is asymmetric — an early prompt
  // burns the single attempt we get, while a late one costs a few days. The route guarantees the
  // age becomes known: the first sighting of a portal creates its rating row, so the clock is
  // running by the time this returns false.
  const ageDays = opts.minInstallAgeDays ?? RATING_MIN_INSTALL_AGE_DAYS
  if (!opts.installedAt) {
    return false
  }
  if (now.getTime() - opts.installedAt.getTime() < ageDays * DAY_MS) {
    return false
  }
  if (!state) {
    return true // old enough and no row yet → first-ever prompt
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
