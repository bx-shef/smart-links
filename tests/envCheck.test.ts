import { describe, it, expect } from 'vitest'
import { checkAppEnv, looksLikePlaceholder } from '~~/server/utils/envCheck'

const base = {
  dbEnabled: true,
  encryptionReady: true,
  edgeSecurity: true,
  tombstoneDays: 30,
  env: { B24_CLIENT_ID: 'local.abc', B24_CLIENT_SECRET: 'secret' } as Record<string, string | undefined>
}

describe('looksLikePlaceholder', () => {
  it('recognises the values people paste in when a variable looks required', () => {
    for (const v of ['xxx', 'XXXXXX', 'changeme', 'TODO', 'your_token', 'insert_secret', '<token>', '‹токен›', '...']) {
      expect(looksLikePlaceholder(v), v).toBe(true)
    }
  })

  it('leaves a real token alone', () => {
    for (const v of ['a1b2c3d4e5f6', 'kq3n1x', 'Zx9-Kk_2']) {
      expect(looksLikePlaceholder(v), v).toBe(false)
    }
  })
})

describe('checkAppEnv', () => {
  it('reports a fully configured app with no complaints', () => {
    const r = checkAppEnv(base)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.summary).toContain('db=on')
    expect(r.summary).toContain('oauth=ready')
    expect(r.summary).toContain('keepalive=on')
  })

  it('flags a placeholder in the OPTIONAL application token', () => {
    // This is the misconfiguration that looks healthy: oauth and encryption report ready, every
    // page works, and every first install is silently rejected with 403.
    const r = checkAppEnv({ ...base, env: { ...base.env, B24_APPLICATION_TOKEN: 'insert_token' } })
    expect(r.errors.join(' ')).toMatch(/B24_APPLICATION_TOKEN/)
    expect(r.errors.join(' ')).toMatch(/OPTIONAL|unset/)
  })

  it('accepts a real application token without complaint', () => {
    const r = checkAppEnv({ ...base, env: { ...base.env, B24_APPLICATION_TOKEN: 'kq3n1xr7' } })
    expect(r.errors).toEqual([])
  })

  it('says plainly that registrations will be refused when OAuth creds are missing', () => {
    const r = checkAppEnv({ ...base, env: {} })
    expect(r.errors.join(' ')).toMatch(/B24_CLIENT_ID/)
    expect(r.summary).toContain('oauth=MISSING')
  })

  it('says the same when the encryption key is unusable', () => {
    const r = checkAppEnv({ ...base, encryptionReady: false })
    expect(r.errors.join(' ')).toMatch(/B24_TOKEN_ENC_KEY/)
    expect(r.summary).toContain('keepalive=off')
  })

  it('treats a missing database as a warning, not an error — the app still works in-portal', () => {
    const r = checkAppEnv({ ...base, dbEnabled: false })
    expect(r.errors).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/DATABASE_URL/)
    expect(r.summary).toContain('db=off')
  })

  it('never puts a secret value in the summary', () => {
    const r = checkAppEnv({ ...base, env: { ...base.env, B24_TOKEN_ENC_KEY: 'super-secret-key-value' } })
    expect(r.summary).not.toContain('secret')
    expect(r.summary).not.toContain('local.abc')
  })
})
