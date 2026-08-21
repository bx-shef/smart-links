import { describe, expect, it } from 'vitest'
import type { UfSmartLinkType } from '#shared/types/base'
import { buildCrmSearchFilter, buildListsSearchFilter } from '~/utils/targetSearch'

// The filter shapes are REST-facts the placement sends verbatim; a drifted key (bare id where the
// Lists convention wants CO_/C_, a lost OR block) fails silently as an empty search result.

function config(over: Partial<UfSmartLinkType['target']> = {}, isFilterBy = { company: true, contact: true, myCompany: false, dogovor: false }): UfSmartLinkType {
  return {
    orign: { clientFields: { companyId: 'companyId', contactId: 'contactId' }, isFilterBy },
    target: {
      entityMode: 'crm',
      entityTypeId: 128,
      clientFields: { companyId: 'UF_CRM_CO', contactId: 'UF_CRM_C' },
      ...over
    }
  } as UfSmartLinkType
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

  it('customFilter comes through and cannot be clobbered silently by origin keys', () => {
    const f = buildCrmSearchFilter(
      config({ customFilter: { stageId: 'WON' } }),
      { companyId: 7, contactId: 9 },
      ''
    )
    expect(f).toEqual({ stageId: 'WON', UF_CRM_CO: 7, UF_CRM_C: 9 })
  })

  it('does not mutate the config customFilter (a shared object survives repeated searches)', () => {
    const custom = { stageId: 'WON' }
    buildCrmSearchFilter(config({ customFilter: custom }), { companyId: 1, contactId: 2 }, '5')
    expect(custom).toEqual({ stageId: 'WON' })
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
})
