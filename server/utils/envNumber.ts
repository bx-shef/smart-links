/**
 * Read a whole-number setting from an environment variable, clamped to a sane range.
 *
 * The empty-string case is the point of this helper. `Number('')` is 0, and 0 is finite, so the
 * obvious `Number.isFinite(n) ? n : fallback` silently accepted an unset variable as zero — and a
 * clamp then turned it into the minimum rather than the documented default. That mismatch is
 * invisible until someone compares behaviour against the docs.
 */
export function readIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const text = (raw ?? '').trim()
  if (!text) return fallback
  const n = Number(text)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}
