import { join, normalize, sep } from 'node:path'

/**
 * Resolve a request path inside the build output, or `null` when it escapes.
 *
 * WHY A SHARED MODULE (lesson from the reference, its #523). Two scripts serve `.output/public`
 * over a local HTTP server — screenshots and the overflow probe. The reference had this lock
 * hand-copied into one of them and MISSING from the other: a raw `GET /../../../../etc/passwd`
 * answered 200. (`fetch` and `curl` cannot reproduce that — they collapse `..` client-side, so
 * "did not reproduce" read as "not vulnerable".)
 *
 * And the deeper point: while the lock lived as a line inside a handler, the only possible guard
 * was textual — "the source contains `startsWith(base + sep)`" — which cannot see an INVERSION:
 * drop one `!` and traversal is served while normal paths get 403, with the guard still green. A
 * pure function is guarded by BEHAVIOR (tests/staticPath.test.ts), and the inversion fails loudly.
 *
 * `normalize` BEFORE `join`: `path.join` normalises its result, so `..` from the URL would climb
 * above the base before any check. The `base + sep` comparison is the second layer: it also stops
 * a sibling directory sharing the name prefix (`/out/public-old`).
 */
export function resolveSafePath(publicDir, rawPath) {
  const decoded = safeDecode(rawPath)
  if (decoded === null) return null
  const path = decoded.endsWith('/') ? `${decoded}index.html` : decoded
  const full = join(publicDir, normalize(path))
  if (full !== publicDir && !full.startsWith(publicDir + sep)) return null
  return full
}

/** Percent-decode that never throws: a broken sequence is a refusal, not a server crash. */
function safeDecode(rawPath) {
  const path = String(rawPath ?? '/').split('?')[0]
  try {
    return decodeURIComponent(path)
  } catch {
    return null
  }
}
