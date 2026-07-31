import { describe, it, expect } from 'vitest'
import { isNumericQuery, mergeSearchRows } from '~/utils/listsSearch'

describe('isNumericQuery', () => {
  it('пропускает в ID-проход только то, что может быть номером записи', () => {
    expect(isNumericQuery('12')).toBe(true)
    expect(isNumericQuery(' 12 ')).toBe(true)
    expect(isNumericQuery('договор')).toBe(false)
    expect(isNumericQuery('12а')).toBe(false)
    expect(isNumericQuery('')).toBe(false)
    expect(isNumericQuery('1.5')).toBe(false)
  })
})

describe('mergeSearchRows', () => {
  it('схлопывает запись, найденную обоими проходами, в одну строку', () => {
    // The defect this pins: element 12 named «Договор №12», searched as "12", matched the ID pass
    // AND the name pass — the user saw it twice, and Vue got two identical v-for keys.
    const byId = [{ ID: '12', NAME: 'Договор №12' }]
    const byName = [{ ID: '12', NAME: 'Договор №12' }, { ID: '7', NAME: 'Договор №127' }]
    expect(mergeSearchRows(byId, byName)).toEqual([
      { id: 12, title: 'Договор №12' },
      { id: 7, title: 'Договор №127' }
    ])
  })

  it('нормализует строковые и числовые ID к одному ключу', () => {
    expect(mergeSearchRows([{ ID: '5', NAME: 'a' }], [{ ID: 5, NAME: 'a' }])).toHaveLength(1)
  })

  it('выбрасывает строки без пригодного номера — их нельзя ни привязать, ни отрисовать с ключом', () => {
    expect(mergeSearchRows([{ ID: 'abc', NAME: 'x' }, { NAME: 'y' }, { ID: '0', NAME: 'z' }])).toEqual([])
  })

  it('сохраняет порядок: сперва точное совпадение по номеру, затем по названию', () => {
    const rows = mergeSearchRows([{ ID: '3', NAME: 'три' }], [{ ID: '1', NAME: 'один' }, { ID: '2', NAME: 'два' }])
    expect(rows.map(r => r.id)).toEqual([3, 1, 2])
  })
})
