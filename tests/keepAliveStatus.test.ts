import { afterEach, describe, expect, it } from 'vitest'
import type { QueryFn } from '~~/server/db/query'
import {
  hydrateKeepAliveHealth, keepAliveHealth, persistKeepAliveHealth, recordKeepAliveRun, resetKeepAliveHealth
} from '~~/server/utils/keepAliveStatus'

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
    // A thrown pass is UNKNOWN, not a lost grant: it must never trip the unrecoverable-portal
    // latch — one transient DB hiccup would otherwise tell the owner «переустановка» forever.
    expect(keepAliveHealth().lostGrant).toBe(false)
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

function fakeQuery(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ sql: string, params?: unknown[] }> = []
  const query: QueryFn = async (sql, params) => {
    calls.push({ sql, params })
    return { rows }
  }
  return { query, calls }
}

describe('persistence across process recycles', () => {
  it('persist upserts the single row and ORs the latch in SQL', async () => {
    recordKeepAliveRun({ failed: 1, lostRotations: 0 }, NOW)
    const { query, calls } = fakeQuery()
    await persistKeepAliveHealth(query)
    expect(calls[0]?.sql).toContain('INSERT INTO maintenance_health')
    expect(calls[0]?.sql).toContain('lost_grant OR EXCLUDED.lost_grant')
    expect(calls[0]?.params).toEqual([NOW.toISOString(), true, false])
  })

  it('a fresh process hydrates the persisted snapshot once', async () => {
    const { query, calls } = fakeQuery([
      { last_run_at: '2026-08-20T00:00:00Z', failing: true, lost_grant: true }
    ])
    await hydrateKeepAliveHealth(query)
    await hydrateKeepAliveHealth(query) // second call must not hit the DB again
    expect(calls.length).toBe(1)
    const s = keepAliveHealth()
    expect(s.failing).toBe(true)
    expect(s.lostGrant).toBe(true)
    expect(s.lastRunAt).toBe(new Date('2026-08-20T00:00:00Z').toISOString())
  })

  it('memory that already ran a pass is never overwritten by hydration', async () => {
    recordKeepAliveRun({ failed: 0, lostRotations: 0 }, NOW)
    const { query } = fakeQuery([
      { last_run_at: '2026-08-01T00:00:00Z', failing: true, lost_grant: true }
    ])
    await hydrateKeepAliveHealth(query)
    const s = keepAliveHealth()
    expect(s.failing).toBe(false) // fresher in-memory pass wins…
    expect(s.lastRunAt).toBe(NOW.toISOString())
    expect(s.lostGrant).toBe(true) // …but the persisted latch still merges in
  })

  it('an unreachable database reads as pristine and does not retry per request', async () => {
    const boom: QueryFn = async () => {
      throw new Error('db down')
    }
    await expect(hydrateKeepAliveHealth(boom)).resolves.toBeUndefined()
    expect(keepAliveHealth()).toEqual({ lastRunAt: null, failing: false, lostGrant: false })
    // The hydrate flag latched on failure: the next call must not attempt the DB again.
    const { query, calls } = fakeQuery([])
    await hydrateKeepAliveHealth(query)
    expect(calls.length).toBe(0)
  })
})
