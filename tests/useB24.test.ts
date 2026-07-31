import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The frame composable holds two invariants that are cheap to get wrong and expensive to debug on
// a live portal: a failed handshake must be CACHED rather than retried, and a handshake that never
// answers must time out. Both are about what does NOT happen, so neither shows up in manual
// testing — a retry that hangs looks exactly like a slow portal.
//
// `initializeB24Frame` is mocked per test and the module is re-imported through `vi.resetModules()`,
// because the composable keeps its state (`frame`, `initPromise`) at module scope on purpose: it is
// resolved once per document, not once per caller.

const initializeB24Frame = vi.fn()

vi.mock('@bitrix24/b24jssdk', () => ({
  initializeB24Frame: (...args: unknown[]) => initializeB24Frame(...args)
}))

async function loadUseB24() {
  vi.resetModules()
  const mod = await import('~/composables/useB24')
  return { ...mod.useB24(), timeoutMs: mod.B24_INIT_TIMEOUT_MS }
}

const fakeFrame = (accessToken = 'tok', domain = 'portal.bitrix24.by') => ({
  auth: { getAuthData: () => ({ access_token: accessToken, domain }) }
})

beforeEach(() => {
  initializeB24Frame.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useB24().init', () => {
  it('returns the frame and keeps it for later callers', async () => {
    const frame = fakeFrame()
    initializeB24Frame.mockResolvedValue(frame)

    const { init, get } = await loadUseB24()
    expect(await init()).toBe(frame)
    expect(get()).toBe(frame)
  })

  it('performs the handshake once even when several callers race for it', async () => {
    // Every in-portal page calls init() in onMounted, and the layout may call it too. A second
    // handshake is not merely wasteful — the SDK cannot do one.
    initializeB24Frame.mockResolvedValue(fakeFrame())

    const { init } = await loadUseB24()
    const [a, b, c] = await Promise.all([init(), init(), init()])

    expect(initializeB24Frame).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('never throws — a page outside a portal gets null', async () => {
    initializeB24Frame.mockRejectedValue(new Error('not in a frame'))

    const { init, get } = await loadUseB24()
    await expect(init()).resolves.toBeNull()
    expect(get()).toBeNull()
  })

  it('CACHES a failed handshake instead of retrying it', async () => {
    // This is the invariant. The SDK latches a module-level flag on its first call, and a second
    // `initializeB24Frame()` after a rejection enters a watch loop that reschedules itself forever
    // — it never settles. So a "retry" would not be a retry, it would be a page frozen in its
    // loading state with no error shown. Recovery is a reload, by design.
    initializeB24Frame.mockRejectedValue(new Error('not in a frame'))

    const { init } = await loadUseB24()
    expect(await init()).toBeNull()
    expect(await init()).toBeNull()
    expect(await init()).toBeNull()

    expect(initializeB24Frame).toHaveBeenCalledTimes(1)
  })

  it('gives up on a portal that never answers the handshake', async () => {
    // B24Frame.init() sends its handshake with no timeout of its own, so without this the await
    // stays pending for the life of the page.
    vi.useFakeTimers()
    initializeB24Frame.mockReturnValue(new Promise(() => {}))

    const { init, timeoutMs } = await loadUseB24()
    const pending = init()
    await vi.advanceTimersByTimeAsync(timeoutMs)

    await expect(pending).resolves.toBeNull()
  })

  it('does not give up early on a slow but working portal', async () => {
    vi.useFakeTimers()
    const frame = fakeFrame()
    const probe = await loadUseB24()
    // Just inside the deadline, expressed from the constant so raising it cannot turn this test
    // into a five-second vitest timeout with no useful message.
    const almost = probe.timeoutMs - 1_000
    initializeB24Frame.mockReturnValue(
      new Promise(resolve => setTimeout(() => resolve(frame), almost))
    )

    const { init } = await loadUseB24()
    const pending = init()
    await vi.advanceTimersByTimeAsync(almost)

    await expect(pending).resolves.toBe(frame)
  })
})

describe('useB24().auth', () => {
  it('is null before the handshake, so callers cannot send a half-built header', async () => {
    const { auth } = await loadUseB24()
    expect(auth()).toBeNull()
  })

  it('returns the token and domain once the frame is up', async () => {
    initializeB24Frame.mockResolvedValue(fakeFrame('abc123', 'shop.bitrix24.by'))

    const { init, auth } = await loadUseB24()
    await init()

    expect(auth()).toEqual({ accessToken: 'abc123', domain: 'shop.bitrix24.by' })
  })

  it('is null when the portal handed back an empty token', async () => {
    // An empty access_token would otherwise be forwarded to our own API, which would answer 401 —
    // a confusing way to learn the frame is not really authorised.
    initializeB24Frame.mockResolvedValue(fakeFrame('', 'shop.bitrix24.by'))

    const { init, auth } = await loadUseB24()
    await init()

    expect(auth()).toBeNull()
  })
})
