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
