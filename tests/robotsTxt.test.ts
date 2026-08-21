import { readdirSync, readFileSync } from 'node:fs'
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

// The other half of the pairing. With the Disallow lines gone, the page-level noindex is the ONLY
// thing keeping in-portal pages out of search results — so it needs its own guard: the meta must
// stay pinned in usePageSeo, and every in-portal page must actually reach a layout that calls it.
describe('the noindex half of the pairing', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

  it('usePageSeo pins robots: noindex, nofollow', () => {
    expect(read('app/composables/usePageSeo.ts')).toContain("robots: 'noindex, nofollow'")
  })

  it('every non-public page reaches a layout that calls usePageSeo', () => {
    // Public, INDEXABLE pages — named, so adding a page is a conscious decision here.
    const PUBLIC_PAGES = new Set(['index.vue', 'privacy.vue'])
    const layoutsDir = resolve(__dirname, '../app/layouts')
    const pagesDir = resolve(__dirname, '../app/pages')

    const seoLayouts = new Set(
      readdirSync(layoutsDir)
        .filter(f => f.endsWith('.vue'))
        .filter(f => readFileSync(resolve(layoutsDir, f), 'utf8').includes('usePageSeo('))
        .map(f => f.replace(/\.vue$/, ''))
    )
    expect(seoLayouts.size).toBeGreaterThan(0)

    const pages: string[] = []
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(resolve(dir, entry.name), `${prefix}${entry.name}/`)
        } else if (entry.name.endsWith('.vue')) {
          pages.push(`${prefix}${entry.name}`)
        }
      }
    }
    walk(pagesDir, '')

    for (const page of pages) {
      if (PUBLIC_PAGES.has(page)) continue
      const src = read(`app/pages/${page}`)
      // Either the page declares a noindex-carrying layout in definePageMeta, or (layout: false)
      // wraps itself in <NuxtLayout name="..."> — the app-options pattern.
      const declared = src.match(/layout: '([\w-]+)'/)?.[1]
      const wrapped = src.match(/<NuxtLayout name="([\w-]+)"/)?.[1]
      const layout = declared ?? wrapped
      expect(layout, `${page} has no layout and no <NuxtLayout> wrapper — it ships without noindex`).toBeTruthy()
      expect(seoLayouts.has(layout!), `${page} uses layout '${layout}' which does not call usePageSeo()`).toBe(true)
    }
  })
})
