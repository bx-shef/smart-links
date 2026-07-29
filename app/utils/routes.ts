// Pure route classification shared by the global middleware (covered by tests).

/**
 * Routes rendered OUTSIDE a Bitrix24 portal — they must not initialise the frame SDK.
 *
 * This is a list, not a single root, because getting it wrong is silent and expensive. `/privacy`
 * was added as a page and to the prerender list but not here, so the global middleware treated the
 * public legal page as in-portal: it pulled the ~300 KB Bitrix24 SDK chunk and ran a frame
 * handshake that can only fail. Nothing surfaced — `init()` swallows the rejection — so the only
 * symptom was a slow page for the moderator and the customer's lawyer reading it.
 *
 * Any new page reachable without a portal belongs here on the same commit that creates it.
 */
const PUBLIC_ROUTES = new Set(['', '/privacy'])

export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.has(path.replace(/\/+$/, ''))
}
