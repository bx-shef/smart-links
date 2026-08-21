import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards for the documentation set (pattern from the reference repo, where docs/ once grew to 40
// files with dead cross-links before a painful cleanup). Two written rules existed here with no
// enforcement: «каждый .md несёт Last reviewed» (CLAUDE.md convention) and «docs/README.md — индекс
// документации». Both had already drifted once — the index was missing two documents when this
// guard landed. A rule without a check is a review note, not a rule.

const ROOT = resolve(__dirname, '..')
const DOCS = resolve(ROOT, 'docs')

const rootDocs = readdirSync(ROOT).filter(f => f.endsWith('.md'))
const docsFiles = readdirSync(DOCS).filter(f => f.endsWith('.md'))

describe('documentation structure', () => {
  it('every .md in the root and docs/ carries a Last reviewed stamp under its H1', () => {
    const all = [
      ...rootDocs.map(f => resolve(ROOT, f)),
      ...docsFiles.map(f => resolve(DOCS, f))
    ]
    expect(all.length).toBeGreaterThan(5) // self-check: the walk actually finds the docs
    for (const path of all) {
      const head = readFileSync(path, 'utf8').split('\n').slice(0, 5).join('\n')
      expect(head, `${path} должен нести «> Last reviewed: YYYY-MM-DD» под заголовком`)
        .toMatch(/^> Last reviewed: \d{4}-\d{2}-\d{2}$/m)
    }
  })

  it('docs/README.md indexes every document, and every indexed document exists', () => {
    const index = readFileSync(resolve(DOCS, 'README.md'), 'utf8')
    const indexed = [...index.matchAll(/\[`([^`]+\.md)`\]\(([^)]+)\)/g)]
      .map(m => m[1]!)
      // The table of contents lists sibling files; cross-references to the same file elsewhere in
      // the page are fine but only the docs/*.md links count for the completeness check.
      .filter(name => !name.includes('/'))

    for (const file of docsFiles) {
      if (file === 'README.md') continue
      expect(indexed, `docs/README.md должен перечислять ${file} в оглавлении`).toContain(file)
    }
    for (const name of indexed) {
      expect(docsFiles, `оглавление docs/README.md ссылается на несуществующий ${name}`).toContain(name)
    }
  })

  it('local links inside docs/ resolve to files that exist', () => {
    // Dead cross-links are how a doc set rots invisibly: the link renders fine until clicked.
    const known = new Set([...docsFiles, ...rootDocs])
    for (const file of docsFiles) {
      const text = readFileSync(resolve(DOCS, file), 'utf8')
      for (const m of text.matchAll(/\]\(([\w./-]+\.md)(#[^)]*)?\)/g)) {
        const target = m[1]!
        const base = target.replace(/^\.\.\//, '').replace(/^docs\//, '')
        expect(known.has(base), `${file} ссылается на несуществующий ${target}`).toBe(true)
      }
    }
  })
})
