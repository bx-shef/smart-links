import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveIblockTypeId, DEFAULT_IBLOCK_TYPE_ID, IBLOCK_TYPE_IDS } from '~/utils/listsTarget'

describe('resolveIblockTypeId', () => {
  it('uses the configured iblock type', () => {
    expect(resolveIblockTypeId({ iblockTypeId: 'bitrix_processes' })).toBe('bitrix_processes')
    expect(resolveIblockTypeId({ iblockTypeId: 'lists_socnet' })).toBe('lists_socnet')
  })

  it('falls back to the company-wide Lists section when nothing is configured', () => {
    // Settings saved before this field existed have no value at all — they must keep working,
    // and `lists` is what the code hardcoded until now.
    expect(resolveIblockTypeId({})).toBe(DEFAULT_IBLOCK_TYPE_ID)
    expect(resolveIblockTypeId({ iblockTypeId: undefined })).toBe('lists')
  })

  it('treats a blank value as unset rather than sending an empty type', () => {
    // The settings form binds a text input, so clearing it yields '' — sending that produces
    // «Неверный тип информационного блока», which reads to the user as a broken field.
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

  it('предлагает в настройках каждый поддерживаемый раздел', () => {
    // The settings form spells the three options out one by one rather than mapping over this
    // list, because an interpolated locale key is invisible to the guards in uiTexts.test.ts. That
    // makes drift possible: adding a type here and forgetting the form would leave a section the
    // placement understands but nobody can select. This is the seam that catches it.
    const form = readFileSync('app/pages/slider/app-options.vue', 'utf8')
    const missing = IBLOCK_TYPE_IDS.filter(id => !form.includes(`value: '${id}'`))
    expect(missing).toEqual([])
  })
})
