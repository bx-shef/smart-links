import { ref } from 'vue'
import type { B24Frame } from '@bitrix24/b24jssdk'
import { Type } from '@bitrix24/b24jssdk'
import type { AppRatingState } from '~/utils/appRating'
import { shouldPromptRating, marketDetailPath } from '~/utils/appRating'

/** Per-user option key holding the rating-prompt state (JSON string). */
const OPTION_KEY = 'appRatingState'

/**
 * Client-side "rate this app" prompt. No backend: the per-user state lives in Bitrix24
 * user options; the show/throttle decision is the pure shouldPromptRating(). The prompt is
 * inert unless a Market listing code is configured (NUXT_PUBLIC_B24_MARKET_CODE).
 */
export function useAppRating() {
  const config = useRuntimeConfig()
  const marketPath = marketDetailPath((config.public.b24MarketCode as string) || '')
  const isEnabled = marketPath !== null

  const isOpen = ref(false)
  let $b24: B24Frame | null = null
  let state: AppRatingState = {}

  async function persist() {
    if (!$b24) {
      return
    }
    // Best-effort: a failed rating save must never bubble up (it's not critical).
    // User options are stored as JSON strings (see @bitrix24/b24jssdk OptionsManager).
    try {
      await $b24.callMethod('user.option.set', {
        options: { [OPTION_KEY]: JSON.stringify(state) }
      })
    } catch (error) {
      console.error('appRating: failed to persist state', error)
    }
  }

  /**
   * Reads the saved state from the loaded user options and opens the prompt if due.
   * Marking `promptedAt` immediately throttles the next prompt.
   * @param userOptions - getB24Helper().userOptions (must have UserOptions loaded).
   */
  async function maybePrompt(
    b24: B24Frame,
    userOptions?: { getJsonObject?: (key: string) => unknown }
  ) {
    if (!isEnabled) {
      return
    }
    $b24 = b24

    let raw: unknown
    try {
      raw = userOptions?.getJsonObject?.(OPTION_KEY)
    } catch {
      raw = undefined
    }
    state = Type.isPlainObject(raw) ? (raw as AppRatingState) : {}

    if (!shouldPromptRating(state, { now: Date.now() })) {
      return
    }

    state = { ...state, promptedAt: Date.now() }
    isOpen.value = true
    await persist()
  }

  /** "Rate" — record the click and open the Market detail page in a slider. */
  async function openMarket() {
    isOpen.value = false
    if (!$b24 || !marketPath) {
      return
    }
    state = { ...state, openedAt: Date.now() }
    await persist()
    try {
      await $b24.slider.openPath($b24.slider.getUrl(marketPath), 950)
    } catch (error) {
      console.error('appRating: failed to open the Market page', error)
    }
  }

  /** "Already rated" — terminal, never prompt again. */
  async function markReviewed() {
    state = { ...state, reviewed: true }
    await persist()
    isOpen.value = false
  }

  /** "Later" — just hide; promptedAt is already set, so it stays throttled. */
  function dismiss() {
    isOpen.value = false
  }

  return { isEnabled, isOpen, maybePrompt, openMarket, markReviewed, dismiss }
}
