import { describe, expect, it } from 'vitest'
import type { UfSmartLinkType } from '#shared/types/base'
import { buildCrmSearchFilter, buildListsSearchFilter } from '~/utils/targetSearch'

// The filter shapes are REST-facts the placement sends verbatim; a drifted key (bare id where the
// Lists convention wants CO_/C_, a lost OR block) fails silently as an empty search result.

// No `as UfSmartLinkType` cast: the assertion swallowed a missing required field and would keep
// swallowing renamed OPTIONAL nested fields — degrading the wrong-source mutation detection
// silently. A typed literal breaks loudly when the shared type moves.
function config(
  over: Partial<UfSmartLinkType['target']> = {},
  isFilterBy: UfSmartLinkType['orign']['isFilterBy'] = { company: true, contact: true, myCompany: false, dogovor: false }
): UfSmartLinkType {
  const base: UfSmartLinkType = {
    ufDestination: 'UF_CRM_SMART_LINK',
    orign: { clientFields: { companyId: 'companyId', contactId: 'contactId' }, isFilterBy },
    target: {
      entityMode: 'crm',
      entityTypeId: 128,
      clientFields: { companyId: 'UF_CRM_CO', contactId: 'UF_CRM_C' }
    }
  }
  return { ...base, target: { ...base.target, ...over } }
}

describe('buildCrmSearchFilter', () => {
  it('composes origin filters with bare numeric ids and the OR query block', () => {
    const f = buildCrmSearchFilter(config(), { companyId: 7, contactId: 9 }, '12')
    expect(f).toEqual({
      UF_CRM_CO: 7,
      UF_CRM_C: 9,
      0: { logic: 'OR', 0: { '=id': '12' }, 1: { '%=title': '%12%' } }
    })
  })

  it('an empty query adds no OR block, disabled origin filters add no keys', () => {
    const f = buildCrmSearchFilter(
      config({}, { company: false, contact: false, myCompany: false, dogovor: false }),
      { companyId: 7, contactId: 9 },
      ''
    )
    expect(f).toEqual({})
  })

  it('customFilter keys come through alongside origin keys (same-named keys: origin wins, as before the extraction)', () => {
    const f = buildCrmSearchFilter(
      config({ customFilter: { stageId: 'WON' } }),
      { companyId: 7, contactId: 9 },
      ''
    )
    expect(f).toEqual({ stageId: 'WON', UF_CRM_CO: 7, UF_CRM_C: 9 })
  })

  it('each origin gate controls only its own key', () => {
    const f = buildCrmSearchFilter(
      config({}, { company: true, contact: false, myCompany: false, dogovor: false }),
      { companyId: 7, contactId: 9 },
      ''
    )
    expect(f).toEqual({ UF_CRM_CO: 7 })
  })

  it('does not mutate the config customFilter, and a one-char query still forms the OR block', () => {
    const custom = { stageId: 'WON' }
    const f = buildCrmSearchFilter(config({ customFilter: custom }), { companyId: 1, contactId: 2 }, '5')
    expect(custom).toEqual({ stageId: 'WON' })
    // The boundary: `length > 0` — a single character is already a query.
    expect(f[0]).toEqual({ logic: 'OR', 0: { '=id': '5' }, 1: { '%=title': '%5%' } })
  })
})

describe('buildListsSearchFilter', () => {
  it('addresses CRM-bound list fields with the CO_/C_ prefixes — a bare id matches nothing', () => {
    const f = buildListsSearchFilter(config({ entityMode: 'lists' }), { companyId: 7, contactId: 9 })
    expect(f).toEqual({ UF_CRM_CO: 'CO_7', UF_CRM_C: 'C_9' })
  })

  it('carries the customFilter and omits disabled origin keys', () => {
    const f = buildListsSearchFilter(
      config({ entityMode: 'lists', customFilter: { ACTIVE: 'Y' } }, { company: true, contact: false, myCompany: false, dogovor: false }),
      { companyId: 7, contactId: 9 }
    )
    expect(f).toEqual({ ACTIVE: 'Y', UF_CRM_CO: 'CO_7' })
  })

  it('does not mutate the config customFilter either — both builders share the promise', () => {
    const custom = { ACTIVE: 'Y' }
    buildListsSearchFilter(config({ entityMode: 'lists', customFilter: custom }), { companyId: 1, contactId: 2 })
    expect(custom).toEqual({ ACTIVE: 'Y' })
  })
})
