// Rating-prompt client helpers. The show/throttle decision now lives on the server
// (server/utils/appRatingPolicy + /api/app-rating); the client only needs the Market path.

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

/**
 * Bitrix24 zones whose public Market catalogue we are willing to link to.
 *
 * Each zone has its OWN catalogue with a different set of listings — a listing that answers 200 on
 * `.ru` can be 404 on `.by`. So the zone is configuration, not a constant: hardcoding `.ru` sends a
 * Belarusian or Kazakh customer to a storefront that does not carry the app.
 */
const MARKET_ZONES = ['ru', 'by', 'kz', 'com'] as const

/** Zone used when none is configured. */
export const DEFAULT_MARKET_ZONE = 'ru'

/**
 * Public Market listing URL, for the landing footer (outside any portal).
 *
 * Not the same thing as `marketDetailPath`, which is an in-PORTAL path opened through the slider.
 * This one is the canonical public form `/apps/app/<code>/` — the shorter `?app=<code>` works but
 * only as a legacy redirect, so linking it costs every visitor an extra hop.
 *
 * Returns null for a blank code (the footer link is then omitted) and falls back to the default
 * zone rather than building a URL on an unknown host.
 */
export function marketListingUrl(
  code: string | undefined | null,
  zone: string | undefined | null = DEFAULT_MARKET_ZONE
): string | null {
  const slug = (code ?? '').trim()
  if (slug.length < 1) {
    return null
  }
  const wanted = (zone ?? '').trim().toLowerCase().replace(/^\./, '')
  const safeZone = (MARKET_ZONES as readonly string[]).includes(wanted) ? wanted : DEFAULT_MARKET_ZONE
  return `https://www.bitrix24.${safeZone}/apps/app/${encodeURIComponent(slug)}/`
}
