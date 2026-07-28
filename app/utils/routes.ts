// Pure route classification shared by the global middleware (covered by tests).

/**
 * Routes rendered OUTSIDE a Bitrix24 portal — they must not initialise the frame SDK.
 * The public landing lives at '/'; in-portal pages live under their own routes (/app, /install, …).
 */
export function isPublicRoute(path: string): boolean {
  return path.replace(/\/+$/, '') === ''
}
