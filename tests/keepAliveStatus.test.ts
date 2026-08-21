import { afterEach, describe, expect, it } from 'vitest'
import { keepAliveHealth, recordKeepAliveRun, resetKeepAliveHealth } from '~~/server/utils/keepAliveStatus'

const NOW = new Date('2026-08-21T12:00:00Z')

afterEach(() => resetKeepAliveHealth())

describe('keep-alive health for /api/health', () => {
  it('starts pristine: never ran, nothing failing', () => {
    expect(keepAliveHealth()).toEqual({ lastRunAt: null, failing: false, lostGrant: false })
  })

  it('a clean pass stamps the time and stays green', () => {
    recordKeepAliveRun({ failed: 0, lostRotations: 0 }, NOW)
    expect(keepAliveHealth()).toEqual({ lastRunAt: NOW.toISOString(), failing: false, lostGrant: false })
  })

  it('per-portal failures and a thrown pass both read as failing', () => {
    recordKeepAliveRun({ failed: 2, lostRotations: 0 }, NOW)
    expect(keepAliveHealth().failing).toBe(true)
    recordKeepAliveRun('error', NOW)
    expect(keepAliveHealth().failing).toBe(true)
  })

  it('failing clears on the next clean pass — it reports the LATEST pass', () => {
    recordKeepAliveRun('error', NOW)
    recordKeepAliveRun({ failed: 0, lostRotations: 0 }, NOW)
    expect(keepAliveHealth().failing).toBe(false)
  })

  it('lostGrant latches: a later clean pass must not hide an unrecoverable portal', () => {
    recordKeepAliveRun({ failed: 1, lostRotations: 1 }, NOW)
    recordKeepAliveRun({ failed: 0, lostRotations: 0 }, NOW)
    const s = keepAliveHealth()
    expect(s.failing).toBe(false)
    expect(s.lostGrant).toBe(true)
  })

  it('exposes flags and a timestamp only — nothing that counts portals', () => {
    recordKeepAliveRun({ failed: 3, lostRotations: 2 }, NOW)
    const s = keepAliveHealth() as unknown as Record<string, unknown>
    expect(Object.keys(s).sort()).toEqual(['failing', 'lastRunAt', 'lostGrant'])
    expect(typeof s.failing).toBe('boolean')
    expect(typeof s.lostGrant).toBe('boolean')
  })
})
