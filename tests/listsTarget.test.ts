import { describe, it, expect } from 'vitest'
import { resolveIblockTypeId, DEFAULT_IBLOCK_TYPE_ID, IBLOCK_TYPE_IDS, ENUMERABLE_IBLOCK_TYPES } from '~/utils/listsTarget'

describe('resolveIblockTypeId', () => {
  it('uses the configured iblock type', () => {
    expect(resolveIblockTypeId({ iblockTypeId: 'bitrix_processes' })).toBe('bitrix_processes')
    expect(resolveIblockTypeId({ iblockTypeId: 'lists_socnet' })).toBe('lists_socnet')
  })

  it('falls back to the universal Lists section when nothing is configured', () => {
    // Settings saved before this field existed have no value at all — they must keep working,
    // and `lists` is what the code hardcoded until now.
    expect(resolveIblockTypeId({})).toBe(DEFAULT_IBLOCK_TYPE_ID)
    expect(resolveIblockTypeId({ iblockTypeId: undefined })).toBe('lists')
  })

  it('treats a blank value as unset rather than sending an empty type', () => {
    // Reachable from a stored option rather than from the form: sending '' produces a hard REST
    // error, which reads to the user as a broken field rather than a misconfigured one.
    expect(resolveIblockTypeId({ iblockTypeId: '' })).toBe('lists')
    expect(resolveIblockTypeId({ iblockTypeId: '   ' })).toBe('lists')
  })

  it('trims a pasted value', () => {
    expect(resolveIblockTypeId({ iblockTypeId: ' bitrix_processes ' })).toBe('bitrix_processes')
  })

  it('passes an unrecognised type through instead of silently substituting a default', () => {
    // A portal can carry a custom iblock type. Bitrix24's own error names the problem better than
    // us quietly querying the wrong section and reporting "nothing found".
    expect(resolveIblockTypeId({ iblockTypeId: 'my_custom_type' })).toBe('my_custom_type')
  })

  it('offers the three types a portal actually answers for', () => {
    expect([...IBLOCK_TYPE_IDS]).toEqual(['lists', 'bitrix_processes', 'lists_socnet'])
    expect(IBLOCK_TYPE_IDS).toContain(DEFAULT_IBLOCK_TYPE_ID)
  })

  it('перечисляет только те разделы, которые портал отдаёт без лишних координат', () => {
    // The settings screen enumerates these to build one combined list picker. Two properties matter
    // and neither is obvious from the constant alone: every enumerable section must be a real one,
    // and the default must be enumerable — otherwise a fresh config points at a section the picker
    // never offers, and the admin is back to typing ids.
    for (const id of ENUMERABLE_IBLOCK_TYPES) {
      expect(IBLOCK_TYPE_IDS).toContain(id)
    }
    expect(ENUMERABLE_IBLOCK_TYPES).toContain(DEFAULT_IBLOCK_TYPE_ID)
    // lists_socnet is deliberately absent: lists.get needs a workgroup id the app never has.
    expect(ENUMERABLE_IBLOCK_TYPES).not.toContain('lists_socnet')
  })

  it('не падает на настройке, пришедшей из портала не строкой', () => {
    // Settings are whatever JSON sits in the portal's app options; nothing validates them per
    // field. Before the typeof guard these threw inside the placement's load path.
    for (const bad of [42, {}, [], true, null]) {
      expect(resolveIblockTypeId({ iblockTypeId: bad as never })).toBe(DEFAULT_IBLOCK_TYPE_ID)
    }
  })
})
