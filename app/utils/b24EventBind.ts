/**
 * Pure builder for the `event.bind` / `event.unbind` batch the install page runs so the server
 * actually receives Bitrix24's outgoing events.
 *
 * Without this the server sees nothing: ONAPPUNINSTALL in particular is only delivered to a bound
 * handler, so an app that never binds keeps a customer's credentials after they remove it and never
 * learns the portal is gone.
 *
 * `event.get` lists only THIS app's bindings, so every entry belongs to us:
 * - a wanted event already bound to `handlerUrl` → leave it (a re-install must be idempotent);
 * - a wanted event bound elsewhere (a stale handler from an older deploy or domain) → unbind;
 * - a wanted event with no matching binding → bind.
 *
 * No SDK import, so this is unit-testable without the b24jssdk runtime — the batch call itself is
 * the caller's job. Ported from the reference app (ai-price-import).
 */

/** Events the server needs delivered. */
export const B24_BOUND_EVENTS = ['ONAPPINSTALL', 'ONAPPUNINSTALL', 'ONAPPUPDATE'] as const

/** One binding as returned by the `event.get` REST method. */
export interface EventBinding {
  event: string
  handler: string
}

/** A single REST call for a batch (`{ method, params }`). */
export interface B24Call {
  method: string
  params: Record<string, unknown>
}

export interface EventBindPlan {
  /** Stale bindings to remove first (best-effort — a missing one is fine). */
  unbind: B24Call[]
  /** Bindings to create for events not already pointing at `handlerUrl`. */
  bind: B24Call[]
}

/**
 * Whether a handler URL is safe to bind: absolute http(s) with a host.
 *
 * A relative or empty URL would register a binding Bitrix can never reach, and the failure is
 * invisible — the install succeeds, and events simply never arrive.
 */
export function isBindableHandlerUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url)
}

/**
 * @param existing bindings from `event.get` (this app's only)
 * @param events events we want bound (case-insensitive; normalised to upper case)
 * @param handlerUrl absolute URL of the server's events endpoint
 */
export function buildEventBindCalls(
  existing: EventBinding[],
  events: readonly string[],
  handlerUrl: string
): EventBindPlan {
  const wanted = events.map(e => e.toUpperCase())
  const wantedSet = new Set(wanted)

  const unbind: B24Call[] = []
  const boundToUs = new Set<string>()
  for (const b of existing) {
    const ev = (b?.event ?? '').toUpperCase()
    if (!wantedSet.has(ev)) continue
    if (b.handler === handlerUrl) boundToUs.add(ev)
    else unbind.push({ method: 'event.unbind', params: { event: ev, handler: b.handler } })
  }

  const bind: B24Call[] = []
  for (const ev of wanted) {
    if (!boundToUs.has(ev)) {
      bind.push({ method: 'event.bind', params: { event: ev, handler: handlerUrl } })
    }
  }

  return { unbind, bind }
}
