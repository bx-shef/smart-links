import { describe, it, expect } from 'vitest'
import { parseRatingAction } from '~~/server/utils/appRatingRequest'

describe('parseRatingAction', () => {
  it('accepts the two valid actions', () => {
    expect(parseRatingAction({ action: 'prompted' })).toBe('prompted')
    expect(parseRatingAction({ action: 'opened' })).toBe('opened')
  })

  it('rejects unknown / missing / malformed bodies', () => {
    expect(parseRatingAction({ action: 'reviewed' })).toBeNull()
    expect(parseRatingAction({ action: 42 })).toBeNull()
    expect(parseRatingAction({})).toBeNull()
    expect(parseRatingAction(null)).toBeNull()
    expect(parseRatingAction('prompted')).toBeNull()
  })
})
