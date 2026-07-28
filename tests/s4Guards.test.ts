import { describe, it, expect } from 'vitest'
import { readIntEnv } from '~~/server/utils/envNumber'
import { clampEventTs, EVENT_TS_FUTURE_SLACK_SEC, EVENT_TS_MAX_AGE_SEC } from '~~/server/utils/eventTs'
import { portalHash } from '~~/server/utils/portalHash'
import { markMaintenanceRun, resetMaintenanceSchedule, shouldRunMaintenance } from '~~/server/utils/maintenanceSchedule'
import { B24_BOUND_EVENTS, buildEventBindCalls, isBindableHandlerUrl } from '~/utils/b24EventBind'

describe('readIntEnv', () => {
  it('uses the fallback for an UNSET variable — not the clamp minimum', () => {
    // Number('') is 0 and 0 is finite, so a naive isFinite check silently clamped to the minimum
    // and the documented default never applied.
    expect(readIntEnv(undefined, 30, 1, 365)).toBe(30)
    expect(readIntEnv('', 30, 1, 365)).toBe(30)
    expect(readIntEnv('   ', 30, 1, 365)).toBe(30)
  })

  it('uses the fallback for a non-numeric value', () => {
    expect(readIntEnv('abc', 30, 1, 365)).toBe(30)
  })

  it('honours a real value and clamps it into range', () => {
    expect(readIntEnv('45', 30, 1, 365)).toBe(45)
    expect(readIntEnv('0', 30, 1, 365)).toBe(1)
    expect(readIntEnv('9999', 30, 1, 365)).toBe(365)
    expect(readIntEnv('7.9', 30, 1, 365)).toBe(7)
  })
})

describe('clampEventTs', () => {
  const NOW = 1_700_000_000

  it('passes a plausible timestamp through', () => {
    expect(clampEventTs(NOW - 10, NOW)).toBe(NOW - 10)
  })

  it('DROPS a far-future timestamp', () => {
    // Stored as a tombstone, a year-2100 value would outlive every sweep and reject that portal's
    // every future install, permanently.
    expect(clampEventTs(4_102_444_800, NOW)).toBe(0)
    expect(clampEventTs(NOW + EVENT_TS_FUTURE_SLACK_SEC + 1, NOW)).toBe(0)
  })

  it('allows a little clock skew', () => {
    expect(clampEventTs(NOW + 60, NOW)).toBe(NOW + 60)
  })

  it('drops an implausibly old timestamp — useless for ordering', () => {
    expect(clampEventTs(NOW - EVENT_TS_MAX_AGE_SEC - 1, NOW)).toBe(0)
  })

  it('drops junk', () => {
    expect(clampEventTs(0, NOW)).toBe(0)
    expect(clampEventTs(-1, NOW)).toBe(0)
    expect(clampEventTs(Number.NaN, NOW)).toBe(0)
    expect(clampEventTs(Number.POSITIVE_INFINITY, NOW)).toBe(0)
  })
})

describe('portalHash', () => {
  it('is stable and case-insensitive', () => {
    expect(portalHash('abc123')).toBe(portalHash('ABC123'))
    expect(portalHash(' abc123 ')).toBe(portalHash('abc123'))
  })

  it('does not contain the member_id it stands for', () => {
    expect(portalHash('secret-member')).not.toContain('secret-member')
    expect(portalHash('m1')).toHaveLength(12)
  })

  it('distinguishes different portals and names the empty case', () => {
    expect(portalHash('a')).not.toBe(portalHash('b'))
    expect(portalHash('')).toBe('anon')
  })
})

describe('maintenance schedule', () => {
  it('runs once per interval, then again after it elapses', () => {
    resetMaintenanceSchedule()
    const T = 1_000_000
    expect(shouldRunMaintenance('job', 1000, T)).toBe(true)
    markMaintenanceRun('job', T)
    expect(shouldRunMaintenance('job', 1000, T + 999)).toBe(false)
    expect(shouldRunMaintenance('job', 1000, T + 1000)).toBe(true)
  })

  it('tracks jobs independently', () => {
    resetMaintenanceSchedule()
    markMaintenanceRun('a', 0)
    expect(shouldRunMaintenance('a', 1000, 500)).toBe(false)
    expect(shouldRunMaintenance('b', 1000, 500)).toBe(true)
  })
})

describe('isBindableHandlerUrl', () => {
  it('accepts an absolute http(s) URL', () => {
    expect(isBindableHandlerUrl('https://app.example.com/api/b24/events')).toBe(true)
  })

  it('rejects anything Bitrix could not call back', () => {
    // A relative or empty handler registers a binding that silently never fires.
    expect(isBindableHandlerUrl('/api/b24/events')).toBe(false)
    expect(isBindableHandlerUrl('')).toBe(false)
    expect(isBindableHandlerUrl('ftp://x/y')).toBe(false)
  })
})

describe('buildEventBindCalls', () => {
  const URL = 'https://app.example.com/api/b24/events'

  it('binds every wanted event on a fresh portal', () => {
    const plan = buildEventBindCalls([], B24_BOUND_EVENTS, URL)
    expect(plan.unbind).toEqual([])
    expect(plan.bind.map(c => c.params.event)).toEqual(['ONAPPINSTALL', 'ONAPPUNINSTALL', 'ONAPPUPDATE'])
    expect(plan.bind[0]!.params.handler).toBe(URL)
  })

  it('is idempotent — a correct binding is left alone', () => {
    const existing = B24_BOUND_EVENTS.map(event => ({ event, handler: URL }))
    expect(buildEventBindCalls(existing, B24_BOUND_EVENTS, URL)).toEqual({ unbind: [], bind: [] })
  })

  it('re-points a binding left over from an older deploy', () => {
    const existing = [{ event: 'ONAPPUNINSTALL', handler: 'https://old.example.com/api/b24/events' }]
    const plan = buildEventBindCalls(existing, ['ONAPPUNINSTALL'], URL)
    expect(plan.unbind).toEqual([
      { method: 'event.unbind', params: { event: 'ONAPPUNINSTALL', handler: 'https://old.example.com/api/b24/events' } }
    ])
    expect(plan.bind.map(c => c.params.event)).toEqual(['ONAPPUNINSTALL'])
  })

  it('matches event names case-insensitively', () => {
    const existing = [{ event: 'onappinstall', handler: URL }]
    expect(buildEventBindCalls(existing, ['ONAPPINSTALL'], URL)).toEqual({ unbind: [], bind: [] })
  })

  it('ignores bindings for events we do not want', () => {
    const existing = [{ event: 'ONCRMDEALADD', handler: 'https://other/x' }]
    const plan = buildEventBindCalls(existing, ['ONAPPINSTALL'], URL)
    expect(plan.unbind).toEqual([])
  })
})
