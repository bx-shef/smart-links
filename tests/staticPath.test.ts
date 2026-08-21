import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSafePath } from '../scripts/lib/staticPath.mjs'

// The traversal lock for the local static servers (screenshot / probe-overflow) is guarded by
// BEHAVIOR here, not by grepping for the check in the source: a textual guard cannot see an
// inverted condition — drop one `!` and traversal is served while normal paths get 403, with the
// grep still green (the reference walked into exactly that; its second script shipped with no
// lock at all because the first one's was an inline copy).

const BASE = '/build/public'

describe('resolveSafePath', () => {
  it('a normal path resolves inside the build dir (this case catches an inverted lock)', () => {
    expect(resolveSafePath(BASE, '/app.js')).toBe(`${BASE}/app.js`)
    expect(resolveSafePath(BASE, '/app/')).toBe(`${BASE}/app/index.html`)
    expect(resolveSafePath(BASE, '/app/?x=1')).toBe(`${BASE}/app/index.html`)
  })

  for (const attack of [
    '/../../../../etc/passwd',
    '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    '/a/../../../../../etc/shadow',
    '/..%2f..%2f.env',
    '/./../../.env'
  ]) {
    it(`traversal stays inside the base: ${attack}`, () => {
      // Either a refusal or a path INSIDE the base — nothing else. Phrased this way because some
      // attempts are collapsed by `normalize` itself, and demanding `null` from those would guard
      // an implementation detail instead of the property.
      const out = resolveSafePath(BASE, attack)
      if (out !== null) expect(out.startsWith(`${BASE}/`), `${attack} → ${out}`).toBe(true)
      expect(out === null || !out.includes('..')).toBe(true)
    })
  }

  it('a broken percent sequence is a refusal, not a server crash', () => {
    expect(resolveSafePath(BASE, '/%ZZ')).toBeNull()
  })

  it('a sibling dir sharing the name prefix is not "inside"', () => {
    // This is why the check uses `+ sep`, not a bare prefix: `/build/public-old` starts with
    // `/build/public` yet is somebody else's directory.
    expect(resolveSafePath('/build/public', '/x')).toBe('/build/public/x')
    expect(resolveSafePath('/build/public-old', '/x')).toBe('/build/public-old/x')
  })
})

describe('local file servers in scripts/ use the shared lock', () => {
  const SCRIPTS = resolve(__dirname, '../scripts')
  const strip = (src: string) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const servers = readdirSync(SCRIPTS)
    .filter(f => f.endsWith('.mjs'))
    .filter(f => strip(readFileSync(resolve(SCRIPTS, f), 'utf8')).includes('createServer('))

  it('such scripts exist at all — otherwise the block below guards nothing', () => {
    expect(servers.length, 'no script with createServer found').toBeGreaterThanOrEqual(2)
  })

  it('every one of them resolves paths through resolveSafePath', () => {
    for (const f of servers) {
      const src = strip(readFileSync(resolve(SCRIPTS, f), 'utf8'))
      expect(src.includes('resolveSafePath('), `${f} serves files without the shared lock`).toBe(true)
    }
  })
})
