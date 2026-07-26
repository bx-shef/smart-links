/** Per-user rating-prompt state, persisted in Bitrix24 user options. */
export interface AppRatingState {
  /** ms — last time the modal was shown (throttling). */
  promptedAt?: number
  /** ms — when the user opened the Market detail page. */
  openedAt?: number
  /** terminal — the user confirmed they left a review; never prompt again. */
  reviewed?: boolean
}

export interface ShouldPromptOptions {
  /** Current time in ms (injected for deterministic testing). */
  now: number
  /** Minimum gap between prompts. Default 4 days. */
  repromptDays?: number
  /** Silence window after the user opened the Market. Default 30 days. */
  openedQuietDays?: number
}

const DAY_MS = 86_400_000

/**
 * Decides whether to show the rating prompt. Pure — `now` is injected.
 * reviewed → never; recently opened the Market → quiet; otherwise throttle by repromptDays.
 */
export function shouldPromptRating(state: AppRatingState, options: ShouldPromptOptions): boolean {
  if (state.reviewed) {
    return false
  }

  const repromptDays = options.repromptDays ?? 4
  const openedQuietDays = options.openedQuietDays ?? 30

  if (typeof state.openedAt === 'number' && options.now - state.openedAt < openedQuietDays * DAY_MS) {
    return false
  }
  if (typeof state.promptedAt === 'number' && options.now - state.promptedAt < repromptDays * DAY_MS) {
    return false
  }

  return true
}

/**
 * Builds the Bitrix24 Market detail path for a listing code.
 * Empty/blank code → null, which the caller treats as "feature disabled" (fail-safe:
 * never open a broken marketplace path).
 */
export function marketDetailPath(code: string | undefined | null): string | null {
  const slug = (code ?? '').trim()
  if (slug.length < 1) {
    return null
  }
  return `/marketplace/detail/${slug}/`
}
