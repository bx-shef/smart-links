/**
 * Parses a JSON object from raw text (used by the settings customFilter field).
 * Empty/whitespace input is treated as an empty object. Arrays, null and
 * primitives are rejected as non-objects. Returns a discriminated result so the
 * caller can map the error to a localized message.
 */
export type ParseJsonObjectResult =
  | { ok: true, value: Record<string, unknown> }
  | { ok: false, error: 'json' | 'not-object' }

export function parseJsonObject(raw: string): ParseJsonObjectResult {
  const trimmed = raw.trim()
  if (trimmed.length < 1) {
    return { ok: true, value: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'json' }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'not-object' }
  }

  return { ok: true, value: parsed as Record<string, unknown> }
}
