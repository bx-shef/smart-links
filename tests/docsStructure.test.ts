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
    const readme = readFileSync(resolve(DOCS, 'README.md'), 'utf8')
    // Parse ONLY the «Оглавление» section: prose elsewhere (the «Статус» paragraph) also links
    // sibling docs, and matching the whole page let a deleted TOC row pass as long as the doc was
    // mentioned anywhere — a mutation run proved five of ten rows were unguarded that way.
    const start = readme.indexOf('## Оглавление')
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = readme.slice(start + 1)
    const end = rest.indexOf('\n## ')
    const index = rest.slice(0, end === -1 ? undefined : end)
    const indexed = [...index.matchAll(/\[`([^`]+\.md)`\]\(([^)]+)\)/g)]
      .map(m => m[1]!)
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
    // Namespaces matter: from inside docs/, a bare `X.md` must be a docs/ sibling, `../X.md` a
    // root file — merging the two pools let `(CLAUDE.md)` written in a docs file pass while the
    // rendered link 404s.
    for (const file of docsFiles) {
      const text = readFileSync(resolve(DOCS, file), 'utf8')
      for (const m of text.matchAll(/\]\(([\w./-]+\.md)(#[^)]*)?\)/g)) {
        const target = m[1]!
        let base = target.replace(/^\.\//, '')
        let pool = docsFiles
        let poolName = 'docs/'
        if (base.startsWith('../')) {
          base = base.slice(3)
          pool = rootDocs
          poolName = 'корне'
        }
        expect(pool.includes(base), `${file} ссылается на ${target}, которого нет в ${poolName}`).toBe(true)
      }
    }
  })
})
