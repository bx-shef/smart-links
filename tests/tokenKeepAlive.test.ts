import { describe, it, expect } from 'vitest'
import { runTokenKeepAlive, selectTokensNearExpiry } from '~~/server/utils/tokenKeepAlive'
import { decryptSecret, encryptSecret } from '~~/server/utils/secretCrypto'
import type { QueryFn } from '~~/server/db/query'

const KEY = Buffer.alloc(32, 3).toString('base64')

/** In-memory portal_tokens, enough for the two statements keep-alive issues. */
function fakeDb(rows: Array<{ memberId: string, refresh: string }>) {
  const store = new Map(rows.map(r => [r.memberId, {
    member_id: r.memberId,
    refresh_token_enc: encryptSecret(r.refresh, KEY),
    access_token: 'old',
    expires_in: 3600
  }]))
  const selects: unknown[][] = []

  const query: QueryFn = async (text, params = []) => {
    const p = params as unknown[]
    if (text.includes('SELECT member_id, refresh_token_enc')) {
      selects.push(p)
      return { rows: [...store.values()].slice(0, Number(p[1])) }
    }
    if (text.includes('UPDATE portal_tokens')) {
      const row = store.get(String(p[0]))
      if (row) Object.assign(row, { access_token: p[1], refresh_token_enc: p[2], expires_in: p[3] })
      return { rows: [] }
    }
    return { rows: [] }
  }
  return { query, store, selects }
}

const okRefresh = async (params: Record<string, string>) => ({
  access_token: `access-for-${params.refresh_token}`,
  refresh_token: `rotated-${params.refresh_token}`,
  expires_in: 3600
})

const deps = (db: ReturnType<typeof fakeDb>, refresh = okRefresh) => ({
  query: db.query,
  refresh,
  clientId: 'cid',
  clientSecret: 'sec',
  encKey: KEY,
  now: () => 1_700_000_000_000
})

describe('selectTokensNearExpiry', () => {
  it('caps the batch so a large install base cannot stall the pass', async () => {
    const db = fakeDb(Array.from({ length: 80 }, (_, i) => ({ memberId: `m${i}`, refresh: `r${i}` })))
    const rows = await selectTokensNearExpiry(db.query)
    expect(rows).toHaveLength(50)
  })

  it('asks for portals untouched longer than the threshold, and clamps a silly threshold', async () => {
    const db = fakeDb([])
    await selectTokensNearExpiry(db.query)
    expect(db.selects[0]![0]).toBe('120') // 180-day lifetime minus the 60-day margin
    await selectTokensNearExpiry(db.query, -5)
    expect(db.selects[1]![0]).toBe('1')
  })
})

describe('runTokenKeepAlive', () => {
  it('refreshes each portal and stores the ROTATED token, re-encrypted', async () => {
    const db = fakeDb([{ memberId: 'm1', refresh: 'r1' }])
    const r = await runTokenKeepAlive(deps(db))
    expect(r).toEqual({ considered: 1, refreshed: 1, failed: 0, failedPortals: [] })

    const stored = db.store.get('m1')!
    expect(stored.access_token).toBe('access-for-r1')
    // Stored encrypted, and it is the rotated value — keeping the old one would strand the portal.
    expect(String(stored.refresh_token_enc)).not.toContain('rotated-r1')
    expect(decryptSecret(String(stored.refresh_token_enc), KEY)).toBe('rotated-r1')
  })

  it('keeps going when one portal fails — a revoked grant must not block the rest', async () => {
    const db = fakeDb([
      { memberId: 'm1', refresh: 'r1' },
      { memberId: 'bad', refresh: 'revoked' },
      { memberId: 'm3', refresh: 'r3' }
    ])
    const refresh = async (params: Record<string, string>) => {
      if (params.refresh_token === 'revoked') throw new Error('invalid_grant')
      return okRefresh(params)
    }
    const r = await runTokenKeepAlive(deps(db, refresh))
    expect(r).toMatchObject({ considered: 3, refreshed: 2, failed: 1 })
    // The failing portal is identified by a pseudonymous hash, never its member_id.
    expect(r.failedPortals).toHaveLength(1)
    expect(r.failedPortals[0]).not.toContain('bad')
    expect(db.store.get('m3')!.access_token).toBe('access-for-r3')
  })

  it('counts a malformed grant as a failure rather than storing nonsense', async () => {
    const db = fakeDb([{ memberId: 'm1', refresh: 'r1' }])
    const r = await runTokenKeepAlive(deps(db, async () => ({ access_token: 'a' })))
    expect(r).toMatchObject({ refreshed: 0, failed: 1 })
    expect(db.store.get('m1')!.access_token).toBe('old')
  })

  it('does nothing when no portal is near expiry', async () => {
    const db = fakeDb([])
    expect(await runTokenKeepAlive(deps(db))).toEqual({ considered: 0, refreshed: 0, failed: 0, failedPortals: [] })
  })
})
