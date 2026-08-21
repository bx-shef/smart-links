import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// An EMPTY assignment in .env beats a non-empty default (reference #305).
//
// Nuxt's applyEnv does `obj[key] = envValue ?? obj[key]`, and an empty string is a value, not
// «unset» — so `KEY=` (or `KEY=""`) in an env file OVERRIDES the default from nuxt.config. The
// prerender runs inside the build with the env applied, which is exactly how the trap fires here:
// a build with .env.example copied verbatim would bake an empty Market zone (default 'ru') into
// the landing, and the Market link would silently vanish. The symptom (a missing footer link, a
// blank build sha) does not look like a configuration mistake — hence a guard, not a review note.

const ROOT = resolve(__dirname, '..')
const example = readFileSync(resolve(ROOT, '.env.example'), 'utf8')
const nuxtConfig = readFileSync(resolve(ROOT, 'nuxt.config.ts'), 'utf8')

/** Keys assigned EMPTY in the example, in every spelling dotenv treats as a SET empty value:
 *  bare `KEY=`, quoted `KEY=""`/`KEY=''`/`KEY=\`\``, with `export `, spaces around `=`, or a
 *  trailing `# comment`. (A quoted blank like `KEY=" "` still evades — it is a non-empty string
 *  to dotenv; the guard covers the empty class, not every whitespace value.) */
function emptyAssignments(): string[] {
  return example
    .split('\n')
    .map(l => l.trim().replace(/^export\s+/, ''))
    .filter(l => /^[A-Z0-9_]+\s*=\s*(?:"{2}|'{2}|`{2})?\s*(?:#.*)?$/.test(l))
    .map(l => l.split('=')[0]!.trim())
}

/**
 * Public runtime-config keys with a NON-EMPTY default. Read from nuxt.config itself rather than a
 * hand-kept list — a hand-kept list would drift and the guard would police yesterday's truth.
 */
function publicKeysWithDefaults(): string[] {
  const start = nuxtConfig.indexOf('public: {')
  const block = nuxtConfig.slice(start, nuxtConfig.indexOf('}', start))
  const out: string[] = []
  for (const m of block.matchAll(/^\s*(\w+):\s*'([^']*)',?\s*$/gm)) {
    const [, name, value] = m
    if (!name || !value) continue // empty default — an empty example line is harmless
    out.push(envNameFor(name))
  }
  return out
}

/** `b24MarketZone` → `NUXT_PUBLIC_B24_MARKET_ZONE`: mirrors Nuxt's own snake-casing (scule),
 *  which splits on lower→UPPER boundaries only — `apiV2Url` maps to `API_V2_URL`, not
 *  `API_V_2_URL`; an extra digit split here would defend a phantom name. */
function envNameFor(camel: string): string {
  return `NUXT_PUBLIC_${camel.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`
}

describe('.env.example does not silently disable documented defaults', () => {
  it('no empty assignment shadows a non-empty public default', () => {
    const empty = emptyAssignments()
    const defended = publicKeysWithDefaults()
    const shadowing = empty.filter(key => defended.includes(key))
    expect(shadowing, `${shadowing.join(', ')} — пустая строка в примере перебила бы умолчание из nuxt.config; либо впишите значение, либо закомментируйте строку`).toEqual([])
  })

  it('the parser actually sees the config defaults it defends', () => {
    // Self-check: if the public block moves or its literal style changes, the previous test would
    // pass vacuously. These two keys are known to carry non-empty defaults today.
    const defended = publicKeysWithDefaults()
    expect(defended).toContain('NUXT_PUBLIC_B24_MARKET_ZONE')
    expect(defended).toContain('NUXT_PUBLIC_COMMIT_SHA')
  })
})
