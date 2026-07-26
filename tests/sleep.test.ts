import { describe, it, expect, vi } from 'vitest'
import { sleepAction } from '~/utils/sleep'

describe('sleepAction', () => {
  it('resolves after the given timeout', async () => {
    vi.useFakeTimers()
    let done = false
    const p = sleepAction(1000).then(() => { done = true })
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(done).toBe(true)
    vi.useRealTimers()
  })

  it('resolves with undefined', async () => {
    await expect(sleepAction(0)).resolves.toBeUndefined()
  })
})
