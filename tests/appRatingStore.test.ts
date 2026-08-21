import { describe, it, expect } from 'vitest'
import type { QueryFn } from '~~/server/db/query'
import {
  getRatingState, markPrompted, markOpened, markReviewed, clearOpened, touchFirstSeen
} from '~~/server/utils/appRatingStore'
import { installCreatedAt } from '~~/server/utils/tokenStore'

/** Fake QueryFn that records calls and returns preset rows. */
function fakeQuery(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ sql: string, params?: unknown[] }> = []
  const query: QueryFn = async (sql, params) => {
    calls.push({ sql, params })
    return { rows }
  }
  return { query, calls }
}

describe('getRatingState', () => {
  it('returns null when there is no row', async () => {
    const { query } = fakeQuery([])
    expect(await getRatingState('c.bitrix24.by', query)).toBeNull()
  })

  it('parses timestamps and the reviewed flag', async () => {
    const { query, calls } = fakeQuery([
      { prompted_at: '2026-06-01T00:00:00Z', opened_at: null, reviewed: true }
    ])
    const state = await getRatingState('c.bitrix24.by', query)
    expect(state?.reviewed).toBe(true)
    expect(state?.promptedAt).toBeInstanceOf(Date)
    expect(state?.openedAt).toBeNull()
    expect(calls[0]?.params).toEqual(['c.bitrix24.by'])
    expect(calls[0]?.sql).toContain('FROM app_rating')
  })

  it('parses the opened_at branch and a null prompted_at', async () => {
    const { query } = fakeQuery([
      { prompted_at: null, opened_at: '2026-06-02T00:00:00Z', reviewed: false }
    ])
    const state = await getRatingState('c.bitrix24.by', query)
    expect(state?.promptedAt).toBeNull()
    expect(state?.openedAt).toBeInstanceOf(Date)
    expect(state?.reviewed).toBe(false)
  })
})

describe('rating mutations', () => {
  it('markPrompted upserts prompted_at and guards a reviewed row', async () => {
    const { query, calls } = fakeQuery()
    await markPrompted('key1', query)
    expect(calls[0]?.sql).toContain('INSERT INTO app_rating')
    expect(calls[0]?.sql).toContain('prompted_at')
    expect(calls[0]?.sql).toContain('reviewed = false')
    expect(calls[0]?.params).toEqual(['key1'])
  })

  it('markOpened upserts opened_at', async () => {
    const { query, calls } = fakeQuery()
    await markOpened('key1', query)
    expect(calls[0]?.sql).toContain('opened_at')
    expect(calls[0]?.params).toEqual(['key1'])
  })

  it('markReviewed sets reviewed = true (terminal)', async () => {
    const { query, calls } = fakeQuery()
    await markReviewed('key1', query)
    expect(calls[0]?.sql).toContain('reviewed = true')
    expect(calls[0]?.params).toEqual(['key1'])
  })

  it('clearOpened nulls opened_at/prompted_at only when not reviewed', async () => {
    const { query, calls } = fakeQuery()
    await clearOpened('key1', query)
    expect(calls[0]?.sql).toContain('opened_at = NULL')
    expect(calls[0]?.sql).toContain('reviewed = false')
    expect(calls[0]?.params).toEqual(['key1'])
  })
})

describe('install-age anchors', () => {
  it('getRatingState carries the row created_at as firstSeenAt', async () => {
    const { query } = fakeQuery([
      { prompted_at: null, opened_at: null, reviewed: false, created_at: '2026-06-01T00:00:00Z' }
    ])
    const state = await getRatingState('c.bitrix24.by', query)
    expect(state?.firstSeenAt).toBeInstanceOf(Date)
  })

  it('a row without created_at yields firstSeenAt null, not an invalid date', async () => {
    const { query } = fakeQuery([
      { prompted_at: null, opened_at: null, reviewed: false, created_at: null }
    ])
    const state = await getRatingState('c.bitrix24.by', query)
    expect(state?.firstSeenAt).toBeNull()
  })

  it('touchFirstSeen inserts the bare row and touches nothing on conflict', async () => {
    const { query, calls } = fakeQuery()
    await touchFirstSeen('c.bitrix24.by', query)
    expect(calls[0]?.sql).toContain('INSERT INTO app_rating (portal_key)')
    expect(calls[0]?.sql).toContain('DO NOTHING')
    expect(calls[0]?.params).toEqual(['c.bitrix24.by'])
  })

  it('installCreatedAt reads portal_tokens.created_at and answers null for unknown keys', async () => {
    const hit = fakeQuery([{ created_at: '2026-06-01T00:00:00Z' }])
    expect(await installCreatedAt('member-1', hit.query)).toBeInstanceOf(Date)
    expect(hit.calls[0]?.sql).toContain('FROM portal_tokens')
    const miss = fakeQuery([])
    expect(await installCreatedAt('c.bitrix24.by', miss.query)).toBeNull()
  })
})
