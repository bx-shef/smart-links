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
    const jargon = ['сущност', 'UF-', '(UF)', 'Uf ', 'entityTypeId', 'инфоблок', 'JSON', 'конфигурац', 'плейсмент']
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
    const blob = sourceBlob()
    const asked = new Set<string>()
    for (const m of blob.matchAll(/\$?t\(\s*['"]([a-z][\w.-]*\.[\w.-]+)['"]/gi)) asked.add(m[1]!)
    expect(asked.size).toBeGreaterThan(10)
    const missing = [...asked].filter(k => !(k in texts))
    expect(missing).toEqual([])
  })

  it('не содержат ключей, на которые никто не ссылается', () => {
    // An orphan key is how the demo leftovers survived a cleanup pass: nothing rendered them, so
    // nothing flagged them, and they stayed until someone read the file line by line.
    const blob = sourceBlob()
    const orphans = Object.keys(texts).filter(k => !blob.includes(k))
    expect(orphans).toEqual([])
  })
})
