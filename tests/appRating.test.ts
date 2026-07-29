import { describe, it, expect } from 'vitest'
import { marketDetailPath, marketListingUrl } from '~/utils/appRating'

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

describe('marketListingUrl', () => {
  it('builds the canonical public listing URL', () => {
    // `/apps/app/<code>/` rather than `?app=<code>`: the latter works, but only as a redirect, so
    // every visitor pays an extra hop.
    expect(marketListingUrl('shef.smartlinks')).toBe('https://www.bitrix24.ru/apps/app/shef.smartlinks/')
  })

  it('honours the configured zone', () => {
    // Each zone has its own catalogue: a listing present on .ru can 404 on .by, so a Belarusian
    // customer sent to the .ru storefront may not find the app at all.
    expect(marketListingUrl('shef.smartlinks', 'by')).toBe('https://www.bitrix24.by/apps/app/shef.smartlinks/')
    expect(marketListingUrl('shef.smartlinks', 'KZ')).toBe('https://www.bitrix24.kz/apps/app/shef.smartlinks/')
    expect(marketListingUrl('shef.smartlinks', '.by')).toBe('https://www.bitrix24.by/apps/app/shef.smartlinks/')
  })

  it('falls back to the default zone rather than building a URL on an unknown host', () => {
    expect(marketListingUrl('a.b', 'evil.example.com')).toBe('https://www.bitrix24.ru/apps/app/a.b/')
    expect(marketListingUrl('a.b', '')).toBe('https://www.bitrix24.ru/apps/app/a.b/')
  })

  it('is null without a code, so the footer link is omitted', () => {
    expect(marketListingUrl('')).toBeNull()
    expect(marketListingUrl('   ')).toBeNull()
    expect(marketListingUrl(undefined)).toBeNull()
  })
})
