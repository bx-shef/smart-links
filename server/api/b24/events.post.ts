import { extractEvent, parseBracketForm } from '../../utils/b24Events'
import { decideB24Event } from '../../utils/b24EventDecision'
import { deletePortal, getApplicationToken, migrateRatingKey, saveToken } from '../../utils/tokenStore'
import { verifyFrameToken } from '../../utils/frameVerify'
import { verifyInstallMember, type RefreshedGrant } from '../../utils/verifyInstallMember'
import { makeOauthRefresh, type FetchLike } from '../../utils/b24Oauth'
import { encryptSecret, tokenEncryptionReady } from '../../utils/secretCrypto'
import { normaliseHost } from '../../utils/b24Rest'
import { clampEventTs } from '../../utils/eventTs'
import { allowWebhookRequest } from '../../utils/frameRateGuard'
import { portalHash } from '../../utils/portalHash'
import { dbEnabled, query } from '../../db/client'

// Bitrix24 outgoing-event webhook: ONAPPINSTALL / ONAPPUNINSTALL.
//
// Bitrix does NOT retry outgoing events, so this handler writes synchronously — there is no queue
// to fall back to, and a dropped event means a portal whose credentials we never stored (or never
// forgot). It is also necessarily public, hence the layered verification below.
//
// Secrets come from process.env rather than useRuntimeConfig(): Nuxt only maps NUXT_-prefixed
// variables into runtimeConfig, and these are deployed under their bare names.
//
// Every exit logs its outcome. An install that never registers is otherwise completely invisible —
// the app still installs into the portal and the in-portal UI still works, so without a log the
// owner has no way to tell "OAuth is working" from "not one portal ever registered".
export default defineEventHandler(async (event) => {
  // Before any I/O: this endpoint is unauthenticated, and each request costs a database round-trip
  // plus, for an install, an outbound call to a client-named host.
  if (!allowWebhookRequest(event)) {
    return { ok: false, error: 'rate limited' }
  }

  // Cap the body here rather than relying on the edge middleware, which is off by default: the
  // whole body is buffered into a string and then split, so an unbounded POST is a memory spike.
  const declared = Number(getHeader(event, 'content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_EVENT_BODY_BYTES) {
    setResponseStatus(event, 413)
    return { ok: false, error: 'payload too large' }
  }

  const body = (await readRawBody(event, 'utf8')) || ''
  const ev = extractEvent(parseBracketForm(body))
  const hash = portalHash(ev.memberId)
  const ts = clampEventTs(ev.ts)

  // A known portal is verified against ITS OWN stored application_token; a first install has none
  // yet and is authenticated by the delivered access_token instead. The env token is an optional
  // extra gate on first install — normally unset.
  const envToken = process.env.B24_APPLICATION_TOKEN ?? ''
  const storedToken = dbEnabled() && ev.memberId ? await getApplicationToken(ev.memberId, query) : null
  const decision = decideB24Event(ev, storedToken, envToken)

  if (decision.action === 'ignore') {
    setResponseStatus(event, decision.status)
    console.info(`[b24-events] ${ev.event || '<none>'} portal=${hash} ignored (${decision.status})`)
    return { ok: decision.status === 200 }
  }
  if (!dbEnabled()) {
    // Nowhere to persist. Report it rather than answer 200 and lose the event silently.
    setResponseStatus(event, 503)
    console.error(`[b24-events] ${ev.event} portal=${hash} REJECTED: no database configured`)
    return { ok: false, error: 'no database' }
  }

  const auth = ev.auth as Record<string, unknown>
  const domain = normaliseHost(ev.domain || String(auth.domain ?? ''))

  if (decision.action === 'unregister') {
    await deletePortal(ev.memberId, query, ts, domain)
    console.info(`[b24-events] ONAPPUNINSTALL portal=${hash} unregistered`)
    return { ok: true }
  }

  // ── register ──────────────────────────────────────────────────────────────────────────────────
  // Every configuration check runs BEFORE the first irreversible step. Verifying the member_id
  // below ROTATES the grant at Bitrix, spending the delivered refresh_token — so a config problem
  // discovered after that point would burn a customer's grant for nothing, and Bitrix does not
  // retry, meaning the only recovery is the customer reinstalling.
  const clientId = process.env.B24_CLIENT_ID ?? ''
  const clientSecret = process.env.B24_CLIENT_SECRET ?? ''
  const encKey = process.env.B24_TOKEN_ENC_KEY ?? ''

  if (!clientId || !clientSecret) {
    // Fail CLOSED. Without these the member_id bind is impossible, and proving control of the
    // domain says nothing about member_id — so accepting the install anyway would let the owner of
    // any real portal register under someone else's member_id and lock that customer out forever.
    setResponseStatus(event, 503)
    console.error(`[b24-events] ${ev.event} portal=${hash} REJECTED: B24_CLIENT_ID/SECRET not configured`)
    return { ok: false, error: 'oauth not configured' }
  }
  if (!tokenEncryptionReady()) {
    setResponseStatus(event, 503)
    console.error(`[b24-events] ${ev.event} portal=${hash} REJECTED: B24_TOKEN_ENC_KEY missing or not 32 bytes`)
    return { ok: false, error: 'token encryption not configured' }
  }

  // First install only: prove the delivered access_token really controls that portal. A known
  // portal already authenticated itself with its stored application_token.
  if (decision.verifyAccessToken) {
    const verdict = await verifyFrameToken({ accessToken: String(auth.access_token ?? ''), domain })
    if (!verdict.ok) {
      setResponseStatus(event, verdict.status ?? 403)
      console.warn(`[b24-events] ONAPPINSTALL portal=${hash} REJECTED: access_token did not verify`)
      return { ok: false, error: 'install verification failed' }
    }
  }

  // Bind member_id on EVERY install, not just the first.
  //
  // Doing it only on the first install left a way to corrupt a working portal: a duplicate or
  // replayed ONAPPINSTALL carries the ORIGINAL refresh_token, which the first delivery already
  // spent by rotating it — and re-registering would overwrite the live grant with that dead one.
  // Re-binding makes the replay fail its own refresh (invalid_grant → 403) and leave the stored
  // grant untouched.
  const bound = await verifyInstallMember(ev.memberId, String(auth.refresh_token ?? ''), {
    refresh: makeOauthRefresh(globalThis.fetch as unknown as FetchLike),
    clientId,
    clientSecret
  })
  if (!bound.ok) {
    setResponseStatus(event, bound.status ?? 403)
    console.warn(`[b24-events] ONAPPINSTALL portal=${hash} REJECTED: member_id bind failed (${bound.status})`)
    return { ok: false, error: 'member verification failed' }
  }
  const grant: RefreshedGrant | undefined = bound.grant

  // The bind guarantees a rotated grant, so a missing refresh token here means Bitrix returned a
  // success without one — a zombie registration we could never refresh. Refuse it loudly.
  if (!grant?.refreshToken) {
    setResponseStatus(event, 503)
    console.error(`[b24-events] ONAPPINSTALL portal=${hash} REJECTED: grant carried no refresh_token`)
    return { ok: false, error: 'grant without refresh token' }
  }

  const saved = await saveToken(
    {
      memberId: ev.memberId,
      // Normalised (bare lower-case host) so the frame lookup, which normalises the same way,
      // matches regardless of scheme or case.
      domain,
      clientEndpoint: grant.clientEndpoint || String(auth.client_endpoint ?? ''),
      accessToken: grant.accessToken,
      refreshTokenEnc: encryptSecret(grant.refreshToken, encKey),
      applicationToken: ev.applicationToken,
      expiresIn: grant.expiresIn,
      issuedAtMs: Date.now()
    },
    query,
    ts
  )

  // Refused ⇒ a stale install arriving after a newer uninstall. Answer 200 so Bitrix stops
  // redelivering, but say so — silently discarding a registration is exactly the failure the owner
  // would otherwise spend a day chasing.
  if (!saved) {
    console.warn(`[b24-events] ONAPPINSTALL portal=${hash} SKIPPED: stale install after a newer uninstall`)
    return { ok: true, skipped: 'stale-install-after-uninstall' }
  }
  // Carry any rating state the portal accumulated under its host key onto its member_id.
  await migrateRatingKey(domain, ev.memberId, query)
  console.info(`[b24-events] ${ev.event} portal=${hash} registered`)
  return { ok: true }
})

/** Largest event body we will buffer. A real webhook is a couple of KB. */
const MAX_EVENT_BODY_BYTES = 64 * 1024
