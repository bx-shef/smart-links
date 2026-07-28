import { EDGE_MAX_BODY_BYTES, edgeBodyGuard, edgeSecurityEnabled } from '../utils/edgeSecurity'

// With APP_EDGE_SECURITY on (the no-proxy Vibecode target), enforce the body cap a reverse proxy's
// `client_max_body_size` would otherwise give. No-op by default.
//
// The security HEADERS are not here — see server/plugins/edgeHeaders.ts for why middleware cannot
// reach prerendered pages.
export default defineEventHandler((event) => {
  if (!edgeSecurityEnabled(process.env)) return

  // Reject an over-cap declared length (413) or an unbounded chunked body with no length (411)
  // BEFORE any handler reads it. A bodyless / Content-Length:0 request is unaffected.
  const status = edgeBodyGuard(getHeader(event, 'content-length'), getHeader(event, 'transfer-encoding'), EDGE_MAX_BODY_BYTES)
  if (status === 413) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  if (status === 411) throw createError({ statusCode: 411, statusMessage: 'Length Required' })
})
