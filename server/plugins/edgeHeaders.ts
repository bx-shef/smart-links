import { buildSecurityHeaders, edgeSecurityEnabled, normalisePathname } from '../utils/edgeSecurity'

// Security headers are attached from a `beforeResponse` hook rather than from server middleware.
//
// Middleware would be the obvious place, but Nitro registers the public-assets handler ahead of it,
// so a request for a PRERENDERED page — every HTML page this app serves, including the ones the
// portal loads in an iframe — is answered before middleware ever runs, and would have gone out with
// no CSP and no `frame-ancestors` at all. Verified: with the headers in middleware, `/api/*` carried
// them and `/` did not. This hook runs for every response, static ones included.
//
// The body guard stays in middleware on purpose: it has to reject BEFORE a handler reads the body,
// and only requests with a body reach a handler anyway.
export default defineNitroPlugin((nitroApp) => {
  if (!edgeSecurityEnabled(process.env)) return

  nitroApp.hooks.hook('beforeResponse', (event) => {
    const pathname = normalisePathname(event.path ?? '/')
    for (const [k, v] of Object.entries(buildSecurityHeaders(pathname))) {
      setResponseHeader(event, k, v)
    }
  })
})
