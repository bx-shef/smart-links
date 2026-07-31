import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ru from '~~/i18n/locales/ru.json'

// The user-facing texts are a contract, not decoration: they are what a Market reviewer screenshots
// and what a portal admin has to act on. This suite guards the three rules the owner set — plain
// words, say "нажмите" where a click is expected, and an error that answers where / what / what
// next — plus the drift that already bit us once: leftovers from the Bitrix demo template shipping
// to production ("Bitrix24::Frame", «Пример поля», «грузим...»).

type Flat = Record<string, string>

function flatten(obj: Record<string, unknown>, prefix = '', out: Flat = {}): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v as Record<string, unknown>, key, out)
    else out[key] = String(v)
  }
  return out
}

const texts = flatten(ru as unknown as Record<string, unknown>)

function sourceBlob(): string {
  const roots = ['app', 'server']
  let blob = ''
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(vue|ts)$/.test(name)) blob += readFileSync(p, 'utf8')
    }
  }
  for (const r of roots) walk(r)
  return blob
}

describe('русские тексты интерфейса', () => {
  it('не содержат следов демо-шаблона Битрикса', () => {
    // These shipped to production once: the app header literally read "Bitrix24::Frame", and the
    // CRM placement carried «Пример поля» / «перестроение графика» from the donor template.
    const banned = ['Bitrix24::Frame', 'Демонстрац', 'Пример пол', 'Пример форм', 'перестроению графика', 'грузим']
    const hits = Object.entries(texts).filter(([, v]) => banned.some(b => v.includes(b)))
    expect(hits).toEqual([])
  })

  it('не показывают пользователю внутренний жаргон', () => {
    // «сущность», «UF», «JSON», «инфоблок» mean nothing to a portal administrator. Where the
    // concept is unavoidable it is spelled out in their words instead ("номер типа записи").
    // «информационн» alongside «инфоблок»: the ban is on the CONCEPT, and the expanded spelling
    // «информационного блока» walked straight past a banlist that only held the contraction.
    const jargon = ['сущност', 'UF-', '(UF)', 'Uf ', 'entityTypeId', 'инфоблок', 'информационн', 'JSON', 'конфигурац', 'плейсмент']
    const hits = Object.entries(texts).filter(([, v]) => jargon.some(j => v.includes(j)))
    expect(hits).toEqual([])
  })

  it('в сообщениях об ошибке говорят, что делать дальше', () => {
    // Rule 3: an error answers where / what happened / what to do. A message with no verb telling
    // the reader what to do next is the failure mode this guards.
    const actionable = /Нажмите|Откройте|Укажите|Попросите|Проверьте|Обновите|Сохраните|Добавьте|Попробуйте|Введите|Закройте|сообщите|Настройку выполняет/
    // Only MESSAGES — button labels ("Обновить") and headings ("Ошибка") carry no instruction by
    // design, and demanding a verb from them would make the rule meaningless.
    const isMessage = (k: string) => /^(error\.|.*\.error\.)/.test(k)
      && !/\.(title|action|clear|home)$|Title$/.test(k)
    // Grouped by message block, not by line: a two-line message legitimately splits "what happened"
    // from "what to do", and judging each line alone would flag the first half of a correct pair.
    const blocks = new Map<string, string[]>()
    for (const [k, v] of Object.entries(texts)) {
      if (!isMessage(k)) continue
      const block = k.replace(/\.(line\d+|description|message)$/, '')
      blocks.set(block, [...(blocks.get(block) ?? []), v])
    }
    expect(blocks.size).toBeGreaterThan(4)
    const mute = [...blocks].filter(([, lines]) => !lines.some(v => actionable.test(v)))
    expect(mute).toEqual([])
  })

  it('не оставляют многоточий вместо описания шага', () => {
    // «Примеры...», «Uf...», «CRM...» were debug captions the installer showed to a real customer.
    const stubs = Object.entries(texts).filter(([k, v]) => k.startsWith('page.install.step') && /^\S{0,12}\.\.\.$/.test(v))
    expect(stubs).toEqual([])
  })

  it('содержат каждый ключ, который запрашивает интерфейс', () => {
    // The mirror image of the orphan check, and the one that actually bit: the cleanup pass deleted
    // `layout.default.navbarHeader.feedback` while the landing navbar still asked for it, so the
    // button rendered its own key as the label. vue-i18n only warns about that at runtime, and the
    // warning scrolls past in a build log — here it fails the suite.
    //
    // Matching on `t(` was tried and is too narrow: keys also reach vue-i18n indirectly, through a
    // helper that takes the key as an argument (`reportActionError(error, 'uf.smart-link.error.load')`),
    // and those were invisible — the three keys added alongside the helper could have been deleted
    // with the suite still green. Anchor on the locale file's own top-level namespaces instead, so
    // a key is found wherever it is written. Case-sensitive on purpose: with `i`, PascalCase
    // arguments like `useAppInit('Layout.IndexPage')` would be mistaken for keys.
    // Anchored on the first TWO segments of a real key, not just the top-level namespace: Bitrix24
    // REST method names collide with the single-segment ones (`app.option.set`, `app.options` vs our
    // only `app.*` key, `app.name`), and matching those would demand junk keys in ru.json to go green.
    const blob = sourceBlob()
    const prefixes = new Set(Object.keys(texts).map(k => k.split('.').slice(0, 2).join('.')))
    expect(prefixes.size).toBeGreaterThan(0)
    const keyLike = /['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g
    const asked = new Set<string>()
    for (const m of blob.matchAll(keyLike)) {
      const key = m[1]!
      if (prefixes.has(key.split('.').slice(0, 2).join('.'))) asked.add(key)
    }
    expect(asked.size).toBeGreaterThan(10)
    const missing = [...asked].filter(k => !(k in texts))
    expect(missing).toEqual([])
  })

  it('не собирают ключ локали из кусков', () => {
    // A key built by interpolation defeats both directions at once: the orphan check stops seeing
    // the key as used and demands its deletion, while the check above cannot resolve what was asked
    // for. Keep every key a whole literal.
    const blob = sourceBlob()
    const namespaces = Object.keys(ru as Record<string, unknown>)
    const interpolated = new RegExp('`(?:' + namespaces.join('|') + ')\\.[^`]*\\$\\{', 'g')
    expect(blob.match(interpolated)).toBeNull()
  })

  it('не содержат ключей, на которые никто не ссылается', () => {
    // An orphan key is how the demo leftovers survived a cleanup pass: nothing rendered them, so
    // nothing flagged them, and they stayed until someone read the file line by line.
    const blob = sourceBlob()
    const orphans = Object.keys(texts).filter(k => !blob.includes(k))
    expect(orphans).toEqual([])
  })
})
