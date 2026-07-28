import { timingSafeEqual } from 'node:crypto'
import type { ParsedB24Event } from './b24Events'

// Pure read-only verdict for an incoming Bitrix24 event. It decides nothing about storage — the
// route stays the single writer. Ported from the reference app (ai-price-import).
//
// Trust model (Bitrix24 «Безопасность в обработчиках»,
// https://apidocs.bitrix24.ru/api-reference/events/safe-event-handlers.html): `application_token`
// is NOT a pre-shared secret — Bitrix DELIVERS it in the first ONAPPINSTALL, and the app remembers
// it per portal. That shapes the two branches below:
//
//   • Known portal (token already stored) → compare the event's token against the STORED one,
//     constant-time. This is the ONLY way to authenticate ONAPPUNINSTALL: its `auth` block exists
//     but carries no access_token/refresh_token (the app's rights are already revoked), so there is
//     nothing else left to verify against.
//   • First install (nothing stored) → the token is being learned right now, so there is nothing
//     to compare against. Authenticate via the delivered access_token instead (the route proves
//     it controls the portal with a cheap authed REST call).

export type B24EventAction = 'register' | 'unregister' | 'ignore'

export interface B24EventDecision {
  /** HTTP status the route should answer with. */
  status: 200 | 400 | 403
  action: B24EventAction
  /** First install only: prove the delivered access_token controls the portal before committing. */
  verifyAccessToken?: boolean
}

/** Constant-time string compare, fail-closed on a length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a ?? '', 'utf8')
  const bb = Buffer.from(b ?? '', 'utf8')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Decide what to do with a parsed event.
 *
 * @param storedToken the portal's remembered application_token, or null when the portal is unknown
 *        (never installed, or already uninstalled).
 * @param envToken optional global gate (B24_APPLICATION_TOKEN). Empty = no gate, the normal setup.
 */
export function decideB24Event(ev: ParsedB24Event, storedToken: string | null, envToken = ''): B24EventDecision {
  if (!ev.event || !ev.memberId) {
    return { status: 400, action: 'ignore' }
  }

  // Known portal → authoritative per-portal comparison (this is what covers ONAPPUNINSTALL).
  if (storedToken) {
    if (!safeEqual(ev.applicationToken, storedToken)) {
      return { status: 403, action: 'ignore' }
    }
    if (ev.event === 'ONAPPINSTALL') return { status: 200, action: 'register' }
    if (ev.event === 'ONAPPUNINSTALL') return { status: 200, action: 'unregister' }
    // ONAPPUPDATE carries an UPDATED application_token together with a fresh grant. Ignoring it was
    // a slow-acting trap: after the first version update from the Market our stored token would be
    // stale, so the portal's next ONAPPUNINSTALL would fail safeEqual and be refused — the customer
    // removes the app and we keep their credentials forever, with no event left to tell us.
    if (ev.event === 'ONAPPUPDATE') return { status: 200, action: 'register' }
    return { status: 200, action: 'ignore' }
  }

  // Unknown portal → only a first install can bootstrap trust. Anything else is unverifiable:
  // there is no stored token, and non-install events carry nothing that could prove otherwise.
  if (ev.event !== 'ONAPPINSTALL') {
    return { status: 403, action: 'ignore' }
  }
  if (envToken && !safeEqual(ev.applicationToken, envToken)) {
    return { status: 403, action: 'ignore' }
  }
  // A first install must carry a token for us to remember, or later events can never be verified.
  if (!ev.applicationToken) {
    return { status: 400, action: 'ignore' }
  }
  return { status: 200, action: 'register', verifyAccessToken: true }
}
