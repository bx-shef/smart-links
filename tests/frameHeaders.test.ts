import { describe, it, expect } from 'vitest'
import { buildFrameHeaders } from '~/utils/frameHeaders'

describe('buildFrameHeaders', () => {
  it('builds Bearer + domain headers', () => {
    expect(buildFrameHeaders({ accessToken: 'abc', domain: 'c.bitrix24.by' })).toEqual({
      Authorization: 'Bearer abc',
      'X-B24-Domain': 'c.bitrix24.by'
    })
  })

  it('returns null without auth / with empty fields', () => {
    expect(buildFrameHeaders(null)).toBeNull()
    expect(buildFrameHeaders(undefined)).toBeNull()
    expect(buildFrameHeaders({ accessToken: '', domain: 'c.bitrix24.by' })).toBeNull()
    expect(buildFrameHeaders({ accessToken: 'abc', domain: '' })).toBeNull()
  })
})
