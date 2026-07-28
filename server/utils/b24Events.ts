// Pure parsing of Bitrix24 outgoing event webhooks, which arrive as PHP bracket-form urlencoded
// bodies:  "event=ONAPPINSTALL&auth[member_id]=abc&auth[application_token]=T&ts=1700000000"
// Ported from the reference app (ai-price-import).

export type B24EventType = 'ONAPPINSTALL' | 'ONAPPUNINSTALL' | string

export interface ParsedB24Event {
  event: B24EventType
  memberId: string
  applicationToken: string
  domain: string
  /**
   * Bitrix24's own event timestamp (top-level `ts`, unix SECONDS). 0 when absent — the
   * event-ordering guard only engages when it is > 0, so a webhook without one still applies.
   */
  ts: number
  data: Record<string, unknown>
  auth: Record<string, unknown>
}

/** Parse a PHP bracket-form urlencoded body into a nested object. */
export function parseBracketForm(body: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  if (!body) return root
  for (const pair of body.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair
    const rawVal = eq >= 0 ? pair.slice(eq + 1) : ''
    assignPath(root, keyPath(safeDecode(rawKey)), safeDecode(rawVal))
  }
  return root
}

/** Decode a form component, tolerating malformed %-escapes (fall back to the raw text). */
function safeDecode(s: string): string {
  const spaced = s.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    return spaced
  }
}

function keyPath(key: string): string[] {
  const m = key.match(/^([^[\]]+)((\[[^[\]]*\])*)$/)
  if (!m) return [key]
  const head = m[1]!
  const rest = [...(m[2] ?? '').matchAll(/\[([^[\]]*)\]/g)].map(x => x[1]!)
  return [head, ...rest]
}

function assignPath(root: Record<string, unknown>, path: string[], value: string): void {
  let node: Record<string, unknown> = root
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!
    // Prototype-pollution guard: the key comes straight off the wire, so `__proto__[x]=y` would
    // otherwise write through to Object.prototype and affect every object in the process.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}
    node = node[k] as Record<string, unknown>
  }
  const last = path[path.length - 1]!
  if (last === '__proto__' || last === 'constructor' || last === 'prototype') return
  node[last] = value
}

/** Extract the normalised event shape from a parsed bracket form. */
export function extractEvent(parsed: Record<string, unknown>): ParsedB24Event {
  const auth = (parsed.auth ?? {}) as Record<string, unknown>
  const data = (parsed.data ?? {}) as Record<string, unknown>
  const tsNum = Number(parsed.ts ?? 0)
  return {
    event: String(parsed.event ?? ''),
    memberId: String(auth.member_id ?? ''),
    applicationToken: String(auth.application_token ?? parsed.application_token ?? ''),
    domain: String(auth.domain ?? parsed.domain ?? ''),
    ts: Number.isFinite(tsNum) && tsNum > 0 ? Math.floor(tsNum) : 0,
    data,
    auth
  }
}
