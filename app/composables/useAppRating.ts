import { ref } from 'vue'
import type { B24Frame } from '@bitrix24/b24jssdk'
import { marketDetailPath } from '~/utils/appRating'
import { buildFrameHeaders } from '~/utils/frameHeaders'

// In-portal «оцените приложение» client. Whether to show the modal is decided SERVER-SIDE
// (per-portal state in app_rating; see server/utils/appRating* + server/api/app-rating). This
// composable only: probes GET /api/app-rating for the show decision, stamps the lifecycle
// (prompted / opened) via POST, and opens the app's Market detail page through slider.openPath.
// Inert outside a portal (no frame auth), without a DB (server → show:false), and when no Market
// code is configured (NUXT_PUBLIC_B24_MARKET_CODE empty).
export function useAppRating() {
  const config = useRuntimeConfig()
  const marketPath = marketDetailPath((config.public.b24MarketCode as string) || '')
  const isEnabled = marketPath !== null

  // Build the API path under the app's baseURL (normally '/') so POST doesn't hit a redirect.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '')
  const apiUrl = `${base}/api/app-rating`

  const isOpen = ref(false)
  let $b24: B24Frame | null = null

  function headers(): Record<string, string> | null {
    const a = $b24?.auth.getAuthData()
    return a ? buildFrameHeaders({ accessToken: a.access_token, domain: a.domain }) : null
  }

  /** Fire-and-forget lifecycle write (must never break the UX). */
  async function report(action: 'prompted' | 'opened'): Promise<void> {
    const h = headers()
    if (!h) {
      return
    }
    try {
      await $fetch(apiUrl, { method: 'POST', headers: h, body: { action } })
    } catch {
      // ignore — the modal UX does not depend on the state write succeeding
    }
  }

  /** Ask the server whether to prompt now; if so, show the modal and throttle it server-side. */
  async function maybePrompt(b24: B24Frame): Promise<void> {
    if (!isEnabled) {
      return
    }
    $b24 = b24
    const h = headers()
    if (!h) {
      return // outside a portal — never nag
    }
    try {
      const r = await $fetch<{ show?: boolean }>(apiUrl, { headers: h })
      if (r?.show) {
        isOpen.value = true
        void report('prompted')
      }
    } catch {
      // any failure → stay silent
    }
  }

  /** «Оценить»: record the click, then open the Market detail page in a portal slider. */
  async function openMarket(): Promise<void> {
    isOpen.value = false
    void report('opened')
    if (!$b24 || !marketPath) {
      return
    }
    try {
      await $b24.slider.openPath($b24.slider.getUrl(marketPath), 950)
    } catch {
      // openPath can reject on unsupported devices — nothing actionable beyond closing the modal.
    }
  }

  /** «Уже оценил(а)»: the user says they rated → suppress until an owner manually verifies (opened). */
  function markReviewed(): void {
    isOpen.value = false
    void report('opened')
  }

  /** «Позже» / close — prompted_at was already stamped server-side, so just hide. */
  function dismiss(): void {
    isOpen.value = false
  }

  return { isEnabled, isOpen, maybePrompt, openMarket, markReviewed, dismiss }
}
