import type { B24Frame } from '@bitrix24/b24jssdk'

// Minimal Bitrix24 frame wrapper (pattern from the reference app). The SDK is imported
// DYNAMICALLY inside init() — only a type import lives at module scope — so this composable,
// which the global middleware pulls into the common chunk, does NOT bundle the ~450 KB B24 SDK
// into the public landing's entry. It loads only when a real frame handshake happens.
// init() is idempotent and never throws; callers treat null as "not in a portal".

let frame: B24Frame | null = null
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
        .then(({ initializeB24Frame }) => initializeB24Frame())
        .then((f) => {
          frame = f
          return f
        })
        .catch(() => {
          // Don't cache a failed handshake — a transient race must not kill the UI until reload.
          initPromise = null
          return null
        })
    }
    return initPromise
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
