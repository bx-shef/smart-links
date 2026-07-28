import { describe, it, expect } from 'vitest'
import { extractEvent, parseBracketForm } from '~~/server/utils/b24Events'
import { decideB24Event, safeEqual } from '~~/server/utils/b24EventDecision'

const install = (over: Partial<ReturnType<typeof extractEvent>> = {}) => ({
  ...extractEvent(parseBracketForm('event=ONAPPINSTALL&auth[member_id]=m1&auth[application_token]=T1')),
  ...over
})

describe('parseBracketForm', () => {
  it('parses the PHP bracket form Bitrix posts', () => {
    const p = parseBracketForm('event=ONAPPINSTALL&auth[member_id]=abc&auth[access_token]=tok&ts=1700000000')
    expect(p.event).toBe('ONAPPINSTALL')
    expect((p.auth as Record<string, unknown>).member_id).toBe('abc')
    expect((p.auth as Record<string, unknown>).access_token).toBe('tok')
    expect(p.ts).toBe('1700000000')
  })

  it('decodes percent-escapes and plus-as-space', () => {
    const p = parseBracketForm('data[TITLE]=hello+world%21&auth[domain]=a.bitrix24.by')
    expect((p.data as Record<string, unknown>).TITLE).toBe('hello world!')
    expect((p.auth as Record<string, unknown>).domain).toBe('a.bitrix24.by')
  })

  it('survives a malformed escape instead of throwing', () => {
    // decodeURIComponent would throw on a lone '%' — the webhook must not 500 over it.
    expect(() => parseBracketForm('event=%E0%A4%A')).not.toThrow()
  })

  it('refuses to write through __proto__ (the body is attacker-controlled)', () => {
    parseBracketForm('__proto__[polluted]=yes&auth[__proto__][x]=y&constructor[z]=1')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('returns an empty object for an empty body', () => {
    expect(parseBracketForm('')).toEqual({})
  })
})

describe('extractEvent', () => {
  it('pulls out the fields the handler needs', () => {
    const ev = extractEvent(parseBracketForm(
      'event=ONAPPINSTALL&ts=1700000000&auth[member_id]=m1&auth[application_token]=T&auth[domain]=a.bitrix24.by'
    ))
    expect(ev).toMatchObject({ event: 'ONAPPINSTALL', memberId: 'm1', applicationToken: 'T', domain: 'a.bitrix24.by', ts: 1700000000 })
  })

  it('reports ts=0 when absent or unusable, so the ordering guard stays out of the way', () => {
    expect(extractEvent(parseBracketForm('event=X&auth[member_id]=m')).ts).toBe(0)
    expect(extractEvent(parseBracketForm('event=X&ts=abc&auth[member_id]=m')).ts).toBe(0)
    expect(extractEvent(parseBracketForm('event=X&ts=-5&auth[member_id]=m')).ts).toBe(0)
  })
})

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects differing or empty values', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(false) // an empty stored token must never authenticate
  })
})

describe('decideB24Event', () => {
  it('rejects a body with no event or no member_id', () => {
    expect(decideB24Event(install({ event: '' }), null)).toMatchObject({ status: 400, action: 'ignore' })
    expect(decideB24Event(install({ memberId: '' }), null)).toMatchObject({ status: 400, action: 'ignore' })
  })

  describe('unknown portal (nothing stored yet)', () => {
    it('bootstraps trust only via a first install, and demands proof of the token', () => {
      expect(decideB24Event(install(), null)).toEqual({ status: 200, action: 'register', verifyAccessToken: true })
    })

    it('refuses any other event — there is nothing to verify it against', () => {
      expect(decideB24Event(install({ event: 'ONAPPUNINSTALL' }), null)).toMatchObject({ status: 403, action: 'ignore' })
      expect(decideB24Event(install({ event: 'ONAPPUPDATE' }), null)).toMatchObject({ status: 403, action: 'ignore' })
      expect(decideB24Event(install({ event: 'ONCRMDEALADD' }), null)).toMatchObject({ status: 403, action: 'ignore' })
    })

    it('refuses a first install that carries no application_token to remember', () => {
      expect(decideB24Event(install({ applicationToken: '' }), null)).toMatchObject({ status: 400, action: 'ignore' })
    })

    it('honours the optional global gate when one is configured', () => {
      expect(decideB24Event(install(), null, 'GATE')).toMatchObject({ status: 403, action: 'ignore' })
      expect(decideB24Event(install({ applicationToken: 'GATE' }), null, 'GATE')).toMatchObject({ status: 200, action: 'register' })
    })
  })

  describe('known portal (token stored)', () => {
    it('accepts an uninstall — which is the whole reason the token is remembered', () => {
      expect(decideB24Event(install({ event: 'ONAPPUNINSTALL' }), 'T1')).toEqual({ status: 200, action: 'unregister' })
    })

    it('accepts a re-install without re-proving the access token', () => {
      expect(decideB24Event(install(), 'T1')).toEqual({ status: 200, action: 'register' })
    })

    it('rejects a mismatched application_token', () => {
      expect(decideB24Event(install({ event: 'ONAPPUNINSTALL', applicationToken: 'WRONG' }), 'T1'))
        .toMatchObject({ status: 403, action: 'ignore' })
    })

    it('re-registers on ONAPPUPDATE, which carries a refreshed application_token', () => {
      // Ignoring it would leave our stored token stale after the first Market version update, and
      // the portal's later ONAPPUNINSTALL would then be refused — we would keep credentials for a
      // customer who removed the app.
      expect(decideB24Event(install({ event: 'ONAPPUPDATE' }), 'T1')).toEqual({ status: 200, action: 'register' })
    })

    it('ignores events it does not handle', () => {
      expect(decideB24Event(install({ event: 'ONCRMDEALADD' }), 'T1')).toMatchObject({ status: 200, action: 'ignore' })
    })
  })
})
