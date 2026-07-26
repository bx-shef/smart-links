import { describe, it, expect } from 'vitest'
import { marketDetailPath } from '~/utils/appRating'

describe('marketDetailPath', () => {
  it('returns null for empty / blank / undefined codes (feature off)', () => {
    expect(marketDetailPath('')).toBeNull()
    expect(marketDetailPath('   ')).toBeNull()
    expect(marketDetailPath(undefined)).toBeNull()
    expect(marketDetailPath(null)).toBeNull()
  })

  it('builds the detail path for a code and trims it', () => {
    expect(marketDetailPath('shef.smartlink')).toBe('/marketplace/detail/shef.smartlink/')
    expect(marketDetailPath('  shef.smartlink  ')).toBe('/marketplace/detail/shef.smartlink/')
  })
})
