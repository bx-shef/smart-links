import { describe, it, expect } from 'vitest'
import { verifyInstallMember } from '~~/server/utils/verifyInstallMember'
import { buildRefreshParams, parseTokenResponse } from '~~/server/utils/b24Oauth'

const deps = (refresh: (p: Record<string, string>) => Promise<unknown>) => ({
  refresh,
  clientId: 'cid',
  clientSecret: 'secret'
})

const grantFor = (memberId: string) => async () => ({
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  expires_in: 3600,
  client_endpoint: 'https://a.bitrix24.by/rest/',
  member_id: memberId
})

describe('buildRefreshParams', () => {
  it('builds a refresh_token grant', () => {
    expect(buildRefreshParams('cid', 'sec', 'rt')).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid',
      client_secret: 'sec',
      refresh_token: 'rt'
    })
  })
})

describe('parseTokenResponse', () => {
  it('accepts a well-formed grant and defaults expires_in', () => {
    const p = parseTokenResponse({ access_token: 'a', refresh_token: 'r', member_id: 'm' })
    expect(p).toMatchObject({ access_token: 'a', refresh_token: 'r', expires_in: 3600, member_id: 'm' })
  })

  it('rejects a response missing either token', () => {
    expect(() => parseTokenResponse({ access_token: 'a' })).toThrow()
    expect(() => parseTokenResponse({ refresh_token: 'r' })).toThrow()
    expect(() => parseTokenResponse('nonsense')).toThrow()
  })
})

describe('verifyInstallMember', () => {
  it('accepts a grant whose authoritative member_id matches the claim', async () => {
    const r = await verifyInstallMember('m1', 'delivered-refresh', deps(grantFor('m1')))
    expect(r.ok).toBe(true)
    expect(r.grant).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 })
  })

  it('returns the ROTATED grant, not the delivered credentials', async () => {
    // The refresh spends the delivered token, so storing it would leave us with dead credentials.
    const r = await verifyInstallMember('m1', 'delivered-refresh', deps(grantFor('m1')))
    expect(r.grant?.refreshToken).not.toBe('delivered-refresh')
  })

  it('compares case-insensitively and ignores surrounding space', async () => {
    const r = await verifyInstallMember('  M1 ', 'rt', deps(grantFor('m1')))
    expect(r.ok).toBe(true)
  })

  it('REJECTS a grant belonging to a different portal (the forged-install case)', async () => {
    const r = await verifyInstallMember('victim', 'attackers-refresh', deps(grantFor('attacker')))
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('rejects when there is nothing to bind against', async () => {
    const never = deps(async () => { throw new Error('should not be called') })
    expect(await verifyInstallMember('', 'rt', never)).toMatchObject({ ok: false, status: 403 })
    expect(await verifyInstallMember('m1', '', never)).toMatchObject({ ok: false, status: 403 })
  })

  it('treats a refused grant as forged (403) but our own misconfiguration as retryable (503)', async () => {
    expect(await verifyInstallMember('m1', 'rt', deps(async () => ({ error: 'invalid_grant' }))))
      .toMatchObject({ ok: false, status: 403 })
    expect(await verifyInstallMember('m1', 'rt', deps(async () => ({ error: 'wrong_client' }))))
      .toMatchObject({ ok: false, status: 503 })
  })

  it('does not permanently reject a real install because the network blipped', async () => {
    const r = await verifyInstallMember('m1', 'rt', deps(async () => { throw new Error('ECONNRESET') }))
    expect(r).toMatchObject({ ok: false, status: 503 })
  })

  it('reports 503, not 403, when the grant echoes no member_id to compare', async () => {
    const r = await verifyInstallMember('m1', 'rt', deps(async () => ({ access_token: 'a', refresh_token: 'r' })))
    expect(r).toMatchObject({ ok: false, status: 503 })
  })

  it('stays fail-closed on a non-object response instead of throwing', async () => {
    // `'error' in <primitive>` would throw and 500 the public webhook.
    const r = await verifyInstallMember('m1', 'rt', deps(async () => 'not json'))
    expect(r).toMatchObject({ ok: false, status: 503 })
  })
})
