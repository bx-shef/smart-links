import { describe, it, expect } from 'vitest'
import {
  deletePortal,
  getApplicationToken,
  memberIdForDomain,
  saveToken,
  sweepTombstones,
  updateTokensOnRefresh
} from '~~/server/utils/tokenStore'
import { portalKeyForHost } from '~~/server/utils/frameVerify'
import { decryptSecret, encryptSecret, tokenEncryptionReady } from '~~/server/utils/secretCrypto'
import type { QueryFn } from '~~/server/db/query'

/** Minimal in-memory stand-in for the three tables the store touches. */
function fakeDb() {
  const tokens = new Map<string, Record<string, unknown>>()
  const tombstones = new Map<string, number>()
  const ratings = new Set<string>()
  const sql: string[] = []

  const query: QueryFn = async (text, params = []) => {
    const p = params as unknown[]
    sql.push(text.trim().split('\n')[0]!.trim())

    if (text.includes('SELECT deleted_ts FROM portal_tombstone')) {
      const ts = tombstones.get(String(p[0]))
      return { rows: ts === undefined ? [] : [{ deleted_ts: ts }] }
    }
    if (text.includes('INSERT INTO portal_tokens')) {
      tokens.set(String(p[0]), {
        member_id: p[0], domain: p[1], client_endpoint: p[2], access_token: p[3],
        refresh_token_enc: p[4], application_token: p[5], expires_in: p[6], issued_at_ms: p[7]
      })
      return { rows: [] }
    }
    if (text.includes('UPDATE portal_tokens')) {
      const row = tokens.get(String(p[0]))
      if (row) Object.assign(row, { access_token: p[1], refresh_token_enc: p[2], expires_in: p[3], issued_at_ms: p[4] })
      return { rows: [] }
    }
    if (text.includes('DELETE FROM portal_tombstone WHERE member_id')) {
      tombstones.delete(String(p[0]))
      return { rows: [] }
    }
    if (text.includes('DELETE FROM portal_tokens')) {
      tokens.delete(String(p[0]))
      return { rows: [] }
    }
    if (text.includes('DELETE FROM app_rating')) {
      ratings.delete(String(p[0]))
      return { rows: [] }
    }
    if (text.includes('INSERT INTO portal_tombstone')) {
      const id = String(p[0])
      tombstones.set(id, Math.max(tombstones.get(id) ?? 0, Number(p[1])))
      return { rows: [] }
    }
    if (text.includes('DELETE FROM portal_tombstone WHERE deleted_ts')) {
      const cutoff = Date.now() / 1000 - Number(p[0])
      for (const [k, v] of tombstones) if (v < cutoff) tombstones.delete(k)
      return { rows: [] }
    }
    if (text.includes('SELECT application_token')) {
      const row = tokens.get(String(p[0]))
      return { rows: row ? [{ application_token: row.application_token }] : [] }
    }
    if (text.includes('SELECT member_id FROM portal_tokens WHERE domain')) {
      for (const row of tokens.values()) {
        if (row.domain === p[0]) return { rows: [{ member_id: row.member_id }] }
      }
      return { rows: [] }
    }
    return { rows: [] }
  }

  return { query, tokens, tombstones, ratings, sql }
}

const input = (over: Record<string, unknown> = {}) => ({
  memberId: 'm1',
  domain: 'a.bitrix24.by',
  clientEndpoint: 'https://a.bitrix24.by/rest/',
  accessToken: 'at',
  refreshTokenEnc: 'enc',
  applicationToken: 'APPTOKEN',
  expiresIn: 3600,
  issuedAtMs: 1_700_000_000_000,
  ...over
})

describe('saveToken', () => {
  it('registers a portal and remembers its application_token', async () => {
    const db = fakeDb()
    expect(await saveToken(input(), db.query, 100)).toBe(true)
    expect(await getApplicationToken('m1', db.query)).toBe('APPTOKEN')
  })

  it('REFUSES an install that predates the uninstall which superseded it', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 200)
    expect(await saveToken(input(), db.query, 100)).toBe(false)
    expect(db.tokens.has('m1')).toBe(false)
  })

  it('refuses an install that ties the uninstall — same second, order unknown, stay removed', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 200)
    expect(await saveToken(input(), db.query, 200)).toBe(false)
  })

  it('accepts a genuine reinstall after the uninstall and clears the tombstone', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 200)
    expect(await saveToken(input(), db.query, 300)).toBe(true)
    // Left behind, the tombstone would make the NEXT install look stale and be refused.
    expect(db.tombstones.has('m1')).toBe(false)
  })

  it('applies the write when the webhook carried no ts (the guard cannot compare)', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 200)
    expect(await saveToken(input(), db.query, 0)).toBe(true)
  })
})

describe('deletePortal', () => {
  it('removes the credentials and the portal-scoped rating row', async () => {
    const db = fakeDb()
    await saveToken(input(), db.query, 100)
    db.ratings.add('m1')
    await deletePortal('m1', db.query, 200)
    expect(db.tokens.has('m1')).toBe(false)
    expect(db.ratings.has('m1')).toBe(false)
    expect(db.tombstones.get('m1')).toBe(200)
  })

  it('keeps the newest uninstall timestamp when two arrive out of order', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 300)
    await deletePortal('m1', db.query, 100)
    expect(db.tombstones.get('m1')).toBe(300)
  })

  it('writes no tombstone when there is no ts to record', async () => {
    const db = fakeDb()
    await deletePortal('m1', db.query, 0)
    expect(db.tombstones.has('m1')).toBe(false)
  })
})

describe('updateTokensOnRefresh', () => {
  it('is UPDATE-only — it must not resurrect a portal uninstalled mid-refresh', async () => {
    const db = fakeDb()
    await updateTokensOnRefresh('gone', { accessToken: 'a', refreshTokenEnc: 'e', expiresIn: 3600, issuedAtMs: 1 }, db.query)
    expect(db.tokens.has('gone')).toBe(false)
  })

  it('rotates the stored grant for a live portal', async () => {
    const db = fakeDb()
    await saveToken(input(), db.query)
    await updateTokensOnRefresh('m1', { accessToken: 'a2', refreshTokenEnc: 'e2', expiresIn: 7200, issuedAtMs: 2 }, db.query)
    expect(db.tokens.get('m1')).toMatchObject({ access_token: 'a2', refresh_token_enc: 'e2', expires_in: 7200 })
  })
})

describe('sweepTombstones', () => {
  it('drops stale tombstones but keeps recent ones', async () => {
    const db = fakeDb()
    const nowSec = Math.floor(Date.now() / 1000)
    db.tombstones.set('old', nowSec - 60 * 24 * 60 * 60)
    db.tombstones.set('fresh', nowSec - 60 * 60)
    await sweepTombstones(30, db.query)
    expect(db.tombstones.has('old')).toBe(false)
    expect(db.tombstones.has('fresh')).toBe(true)
  })
})

describe('memberIdForDomain / portalKeyForHost', () => {
  it('prefers member_id for an installed portal', async () => {
    const db = fakeDb()
    await saveToken(input(), db.query)
    expect(await memberIdForDomain('a.bitrix24.by', db.query)).toBe('m1')
    expect(await portalKeyForHost('a.bitrix24.by', d => memberIdForDomain(d, db.query))).toBe('m1')
  })

  it('falls back to the verified host when the portal was never installed via OAuth', async () => {
    const db = fakeDb()
    expect(await portalKeyForHost('b.bitrix24.by', d => memberIdForDomain(d, db.query))).toBe('b.bitrix24.by')
  })

  it('reports NULL when the lookup fails, rather than silently using the host', async () => {
    // Falling back here would split one portal's state: reads resolving to member_id, writes to the
    // host, whenever the database is only half-available.
    expect(await portalKeyForHost('c.bitrix24.by', async () => { throw new Error('db down') })).toBeNull()
  })
})

describe('secretCrypto', () => {
  const key = Buffer.alloc(32, 7).toString('base64')

  it('round-trips a refresh token', () => {
    expect(decryptSecret(encryptSecret('refresh-me', key), key)).toBe('refresh-me')
  })

  it('produces a different blob each time (random IV)', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key))
  })

  it('fails loudly on a tampered ciphertext rather than returning garbage', () => {
    const blob = encryptSecret('secret', key)
    const [iv, tag, data] = blob.split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString('base64')}`, key)).toThrow()
  })

  it('rejects a wrong key and a malformed blob', () => {
    const other = Buffer.alloc(32, 9).toString('base64')
    expect(() => decryptSecret(encryptSecret('s', key), other)).toThrow()
    expect(() => decryptSecret('garbage', key)).toThrow()
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('s', Buffer.alloc(16, 1).toString('base64'))).toThrow(/32 bytes/)
    expect(tokenEncryptionReady({ B24_TOKEN_ENC_KEY: '' })).toBe(false)
    expect(tokenEncryptionReady({ B24_TOKEN_ENC_KEY: key })).toBe(true)
  })
})
