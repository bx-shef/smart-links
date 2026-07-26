import { describe, it, expect } from 'vitest'
import { parseJsonObject } from '~/utils/parseJsonObject'

describe('parseJsonObject', () => {
  it('treats empty / whitespace input as an empty object', () => {
    expect(parseJsonObject('')).toEqual({ ok: true, value: {} })
    expect(parseJsonObject('   \n ')).toEqual({ ok: true, value: {} })
  })

  it('parses a valid JSON object', () => {
    expect(parseJsonObject('{ "PROPERTY_RAZOVYY": false }')).toEqual({
      ok: true,
      value: { PROPERTY_RAZOVYY: false }
    })
  })

  it('rejects malformed JSON', () => {
    expect(parseJsonObject('{ bad json')).toEqual({ ok: false, error: 'json' })
  })

  it('rejects arrays and primitives as non-objects', () => {
    expect(parseJsonObject('[1, 2]')).toEqual({ ok: false, error: 'not-object' })
    expect(parseJsonObject('42')).toEqual({ ok: false, error: 'not-object' })
    expect(parseJsonObject('"str"')).toEqual({ ok: false, error: 'not-object' })
    expect(parseJsonObject('null')).toEqual({ ok: false, error: 'not-object' })
  })
})
