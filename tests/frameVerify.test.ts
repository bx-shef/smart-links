import { describe, it, expect } from 'vitest'
import { verifyFrameToken } from '~~/server/utils/frameVerify'
import type { RestCall } from '~~/server/utils/b24Rest'

const auth = { accessToken: 'tok', domain: 'c.bitrix24.by' }

/** Fake REST factory: returns a caller that resolves `result` or throws `err`. */
function fakeMakeCall(result: unknown, err?: Error) {
  return (): RestCall => async () => {
    if (err) {
      throw err
    }
    return result
  }
}

describe('verifyFrameToken', () => {
  it('ok=true, admin=true and canonical host when profile.ADMIN is true', async () => {
    const res = await verifyFrameToken(auth, { makeCall: fakeMakeCall({ ID: '1', ADMIN: true }) })
    expect(res).toEqual({ ok: true, admin: true, host: 'c.bitrix24.by' })
  })

  it('REJECTS a reply that is not a real profile — verification needs a positive signal', async () => {
    // A host inside the Bitrix24 zones that answers an unknown path with anything non-REST would
    // otherwise count as "token verified": the call resolves without erroring, and that used to be
    // the whole test. The domain comes from the client, so this is the barrier that matters.
    for (const reply of [null, undefined, {}, 'html', 42]) {
      const res = await verifyFrameToken(auth, { makeCall: fakeMakeCall(reply) })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(401)
    }
  })

  it('ok=true, admin=false and canonical host when profile.ADMIN is not true', async () => {
    const res = await verifyFrameToken(
      { accessToken: 'tok', domain: 'https://C.Bitrix24.BY/rest' },
      { makeCall: fakeMakeCall({ ID: '1', ADMIN: false }) }
    )
    expect(res).toEqual({ ok: true, admin: false, host: 'c.bitrix24.by' })
  })

  it('401 token-rejected on an auth error', async () => {
    const res = await verifyFrameToken(auth, { makeCall: fakeMakeCall(null, new Error('invalid_token')) })
    expect(res).toEqual({ ok: false, status: 401, reason: 'token-rejected' })
  })

  it('502 transport on a network error', async () => {
    const res = await verifyFrameToken(auth, { makeCall: fakeMakeCall(null, new Error('network down')) })
    expect(res).toEqual({ ok: false, status: 502, reason: 'transport' })
  })
})
