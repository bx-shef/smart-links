import { describe, expect, it } from 'vitest'
import {
  crmNewTargetPath, crmTargetPathTemplate, DYNAMIC_TYPE_MIN, isDynamicCrmType, SMART_INVOICE_TYPE_ID
} from '~/utils/crmTargetPath'

// The route scheme mirrors the reference's live-verified builders. A wrong branch here is a dead
// «открыть»/«создать» — or worse, a live-looking link into the portal's 404 (the universal route
// does NOT resolve quotes; the reference proved that live).
describe('crmTargetPathTemplate', () => {
  it('lead and deal ride their named routes', () => {
    expect(crmTargetPathTemplate(1)).toBe('/crm/lead/details/#entityId#/')
    expect(crmTargetPathTemplate(2)).toBe('/crm/deal/details/#entityId#/')
  })

  it('the smart invoice and smart processes ride the universal /crm/type/ route', () => {
    expect(crmTargetPathTemplate(SMART_INVOICE_TYPE_ID)).toBe('/crm/type/31/details/#entityId#/')
    expect(crmTargetPathTemplate(128)).toBe('/crm/type/128/details/#entityId#/')
    // Real portals mint dynamic ids far above 128 (a live doc example carries 1256).
    expect(crmTargetPathTemplate(1256)).toBe('/crm/type/1256/details/#entityId#/')
  })

  it('unoffered legacy types answer an empty path, not a guessed one', () => {
    // Contact, company, quote, the old invoice: the universal route does not resolve them (quote
    // proven live by the reference), and an empty path is an honest disabled button.
    for (const etid of [3, 4, 5, 7]) {
      expect(crmTargetPathTemplate(etid)).toBe('')
      expect(crmNewTargetPath(etid)).toBe('')
    }
  })

  it('creation paths substitute id 0 in the same routes', () => {
    expect(crmNewTargetPath(1)).toBe('/crm/lead/details/0/')
    expect(crmNewTargetPath(2)).toBe('/crm/deal/details/0/')
    expect(crmNewTargetPath(SMART_INVOICE_TYPE_ID)).toBe('/crm/type/31/details/0/')
    expect(crmNewTargetPath(1256)).toBe('/crm/type/1256/details/0/')
  })

  it('the dynamic-type boundary is exact', () => {
    expect(isDynamicCrmType(DYNAMIC_TYPE_MIN)).toBe(true)
    expect(isDynamicCrmType(DYNAMIC_TYPE_MIN - 1)).toBe(false)
    expect(isDynamicCrmType(SMART_INVOICE_TYPE_ID)).toBe(true)
  })
})
