import type { B24Frame } from '@bitrix24/b24jssdk'

// Minimal Bitrix24 frame wrapper (pattern from the reference app). The SDK is imported DYNAMICALLY
// inside init() — only a type import lives at module scope — so this composable, which the global
// middleware pulls into the common chunk, does NOT bundle the ~300 KB B24 SDK into the public
// landing's entry. It loads only when a real frame handshake happens.
//
// init() is idempotent and never throws; callers treat null as "not in a portal / handshake failed".

/** How long to wait for the portal handshake before giving up. */
export const B24_INIT_TIMEOUT_MS = 10_000

let frame: B24Frame | null = null
// Resolved ONCE per document, to the frame or to null — see the note in init() on why a failure
// must be cached rather than retried.
let initPromise: Promise<B24Frame | null> | null = null

export function useB24() {
  async function init(): Promise<B24Frame | null> {
    if (frame) {
      return frame
    }
    if (!import.meta.client) {
      return null
    }
    if (!initPromise) {
      initPromise = import('@bitrix24/b24jssdk')
        .then(({ initializeB24Frame }) => withTimeout(initializeB24Frame()))
        .then((f) => {
          frame = f
          return f
        })
        .catch(() => null)
    }
    return initPromise
  }

  /**
   * A failed handshake is CACHED, never retried, because the SDK cannot be retried in the same
   * document: `initializeB24Frame` latches a module-level `isMakeFirstCall`, and after the first
   * rejection every later call falls into its watch loop, which reschedules itself while `isInit`
   * stays false and so never settles. Clearing `initPromise` here would therefore not produce a
   * second attempt — it would produce a promise that hangs forever, freezing the caller's page in
   * its loading state with no error shown. Recovering needs a page reload.
   *
   * The timeout covers the other half: `B24Frame.init()` sends its handshake without one, so an
   * unresponsive parent portal would otherwise leave `await init()` pending indefinitely.
   */
  async function withTimeout(p: Promise<B24Frame>): Promise<B24Frame> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Bitrix24 frame handshake timed out')), B24_INIT_TIMEOUT_MS)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** The already-initialised frame, or null. */
  function get(): B24Frame | null {
    return frame
  }

  /** Frame auth for server API headers, or null when not framed / not ready. */
  function auth(): { accessToken: string, domain: string } | null {
    const a = frame?.auth.getAuthData()
    if (!a || !a.access_token) {
      return null
    }
    return { accessToken: a.access_token, domain: a.domain }
  }

  /**
   * Open an in-app slider page (`place` is routed by the global middleware). One shared entry for
   * the payload, ported from the reference: the option keys are magic strings the portal parses
   * (`bx24_width`, `bx24_title`), and the typo class `bx24_witdh` produces a default-size slider
   * with no error anywhere — the payload shape is pinned by tests/useB24.test.ts. Extra string
   * params (e.g. ufCode for the settings slider) ride along into `placement.options`.
   *
   * Returns false when not framed or the portal refused — callers treat that as «no slider».
   *
   * ⚠ Known portal defect, NOT ours (b24jssdk#328, dug out by the reference): after CLOSING a
   * slider the portal's own close handler throws on a cyclic-JSON serialise before reaching
   * `focusTrap.deactivate()`, so the parent page keeps `inert` — the portal stops responding to
   * clicks until reload. Changing the close method cannot dodge it: `parent.closeApplication()`
   * and `slider.closeSliderAppPage()` send the IDENTICAL command (verified in the SDK source by
   * the reference). Nothing to fix on our side; the fix is awaited in the portal.
   */
  async function openAppSlider(
    place: string,
    opts: { width: number, title?: string, params?: Record<string, string> }
  ): Promise<'opened' | 'no-frame' | 'refused'> {
    const f = await init()
    if (!f) {
      // Outside a portal (or a cached failed handshake). Callers stay silent here — the same
      // click was a silent no-op before the wrapper, and there is no portal to complain to.
      return 'no-frame'
    }
    // The magic keys are stripped from params rather than relying on spread order: `place` is
    // spread first (a params «place» would win and reroute the slider), and an absent title
    // leaves the bx24_title slot open. No current caller passes them — this keeps the JSDoc
    // claim true instead of mostly-true.
    const params = Object.fromEntries(
      Object.entries(opts.params ?? {}).filter(([key]) => !['place', 'bx24_width', 'bx24_title'].includes(key))
    )
    try {
      await f.slider.openSliderAppPage({
        place,
        ...params,
        bx24_width: opts.width,
        ...(opts.title ? { bx24_title: opts.title } : {})
      })
      return 'opened'
    } catch (error) {
      // Distinct from 'no-frame': HERE a real portal refused a real command — callers with an
      // error surface should show it (a click that silently does nothing breaks text rule 3).
      console.warn('[useB24] portal refused to open slider', place, error)
      return 'refused'
    }
  }

  /** Close the current app slider overlay. Swallows «not framed». See the b24jssdk#328 note on
   *  openAppSlider: the portal may leave the parent page inert after this — known, not ours. */
  async function closeSlider(): Promise<void> {
    const f = await init()
    try {
      await f?.parent.closeApplication()
    } catch (error) {
      // A refused close leaves the slider on screen — the person can still close it with the
      // portal's own «×», so log rather than surface.
      console.warn('[useB24] portal refused to close slider', error)
    }
  }

  return { init, get, auth, openAppSlider, closeSlider }
}
