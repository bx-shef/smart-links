import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight, reloadDelayMs, SETTINGS_RELOAD_JITTER_MS } from '../app/utils/loadCoalesce'

/** A task whose completion the test controls. */
function makeGate() {
  let release!: () => void
  let fail!: (e: Error) => void
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { gate, release, fail }
}

describe('createSingleFlight: concurrent loads coalesce', () => {
  it('ten calls during one flight produce TWO task runs, not ten', async () => {
    const flight = createSingleFlight()
    let runs = 0
    const gates = [makeGate(), makeGate()]
    const task = async () => {
      const g = gates[runs]!
      runs += 1
      await g.gate
    }

    const first = flight.run(task)
    const joiners = Array.from({ length: 9 }, () => flight.run(task))
    expect(runs).toBe(1)

    gates[0]!.release()
    // The first flight's promise settles only after the tail lands, so the tail's gate must open
    // BEFORE awaiting it. Wait for the tail to start, then release it.
    await vi.waitFor(() => expect(runs).toBe(2))
    gates[1]!.release()
    await first
    await Promise.all(joiners)
    // The nine joiners collapsed into that one trailing re-run — two task runs total.
    expect(runs).toBe(2)
  })

  it('the trailing re-run is mandatory — joining the old flight is not enough', async () => {
    // The trailing task must START after the first flight LANDS: a caller arriving mid-flight
    // arrives because settings just changed, and the in-air request predates that change.
    const flight = createSingleFlight()
    const order: string[] = []
    const g1 = makeGate()
    let call = 0
    const task = async () => {
      call += 1
      const n = call
      order.push(`start${n}`)
      if (n === 1) {
        await g1.gate
      }
      order.push(`end${n}`)
    }

    const p1 = flight.run(task)
    void flight.run(task)
    g1.release()
    await p1
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('without overlap there is no re-run', async () => {
    const flight = createSingleFlight()
    let runs = 0
    await flight.run(async () => {
      runs += 1
    })
    await flight.run(async () => {
      runs += 1
    })
    expect(runs).toBe(2)
  })

  it('after a FAILURE the next call hits the network again', async () => {
    const flight = createSingleFlight()
    let runs = 0
    await expect(flight.run(async () => {
      runs += 1
      throw new Error('boom')
    })).rejects.toThrow('boom')
    await flight.run(async () => {
      runs += 1
    })
    expect(runs).toBe(2)
  })

  it('a failure DROPS the queued tail instead of leaving it for the next caller', async () => {
    const flight = createSingleFlight()
    let runs = 0
    const g = makeGate()
    const failing = async () => {
      runs += 1
      await g.gate
    }

    const p1 = flight.run(failing)
    const p2 = flight.run(failing) // queues the tail
    g.fail(new Error('portal refused'))
    await expect(p1).rejects.toThrow('portal refused')
    await expect(p2).rejects.toThrow('portal refused')
    // No tail ran after the failure…
    expect(runs).toBe(1)

    // …and the armed flag did not leak onto the next, unrelated call: it runs exactly once.
    await flight.run(async () => {
      runs += 1
    })
    expect(runs).toBe(2)
  })

  it('joiners receive the same rejection as the initiator', async () => {
    const flight = createSingleFlight()
    const g = makeGate()
    const task = async () => {
      await g.gate
    }
    const p1 = flight.run(task)
    const p2 = flight.run(task)
    g.fail(new Error('same for everyone'))
    await expect(p1).rejects.toThrow('same for everyone')
    await expect(p2).rejects.toThrow('same for everyone')
  })
})

describe('reloadDelayMs: spread before a broadcast-triggered reload', () => {
  it('stays inside the window and is never negative', () => {
    expect(reloadDelayMs(() => 0)).toBe(0)
    expect(reloadDelayMs(() => 0.5)).toBe(SETTINGS_RELOAD_JITTER_MS / 2)
    expect(reloadDelayMs(() => 0.999999)).toBeLessThan(SETTINGS_RELOAD_JITTER_MS)
    for (let i = 0; i < 100; i += 1) {
      const d = reloadDelayMs()
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThan(SETTINGS_RELOAD_JITTER_MS)
    }
  })

  it('a broken randomness source cannot produce a negative or infinite delay', () => {
    expect(reloadDelayMs(() => Number.NaN)).toBe(0)
    expect(reloadDelayMs(() => Number.POSITIVE_INFINITY)).toBe(0)
    expect(reloadDelayMs(() => -1)).toBe(0)
    expect(reloadDelayMs(() => 1)).toBe(0)
    expect(reloadDelayMs(() => 2)).toBe(0)
  })
})
