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

  return { init, get, auth }
}
