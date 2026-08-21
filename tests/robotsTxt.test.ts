import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// robots.txt and the in-portal noindex must not fight each other. A Disallow'ed URL is never
// crawled, so a noindex on that page is never SEEN — and the URL can still end up indexed from an
// external link (listed without a snippet). The in-portal pages (/app, /install, /handler/*,
// /slider/*) are kept out of search results by `usePageSeo`'s `noindex, nofollow` alone, which
// only works while robots.txt lets the crawler fetch them. The one legitimate Disallow is /api/:
// API routes carry no meta tags and have nothing to be indexed for.
describe('public/robots.txt', () => {
  const text = readFileSync(resolve(__dirname, '../public/robots.txt'), 'utf8')
  const disallows = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^disallow:/i.test(line))
    .map(line => line.replace(/^disallow:\s*/i, ''))

  it('disallows only /api/ so page-level noindex stays visible to crawlers', () => {
    expect(disallows).toEqual(['/api/'])
  })

  it('keeps the site open for crawling overall', () => {
    expect(text).toMatch(/^Allow: \/$/m)
    expect(text).toMatch(/^User-agent: \*$/m)
  })
})
