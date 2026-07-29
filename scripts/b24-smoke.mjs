// Live REST smoke against a real Bitrix24 portal. Dev-only, read-only, never run in CI.
//
//   pnpm b24:smoke
//
// Reads an inbound webhook URL from the git-ignored `.env.b24test`:
//
//   B24_HOOK=https://<portal>.bitrix24.<zone>/rest/<user>/<token>/
//
// The point is to check the REST FACTS the app is built on against a portal instead of against
// memory — the repo convention says exactly that, and the app had a bug this catches (see the
// IBLOCK_TYPE_ID check below). It reads; it never writes.
//
// WHAT A WEBHOOK CANNOT COVER. A webhook runs outside application context, so `userfieldtype.*`
// answers «Current authorization type is denied for this method. Application context required»,
// and `app.option.*`/`placement.*` are equally out of reach. That means UF-type registration, the
// settings store and the placement handshake are NOT verifiable this way — they need the app
// installed on a portal, which is the owner's live run. This script deliberately reports that
// boundary rather than pretending to cover it.
import { readFileSync } from 'node:fs'

const ENV_FILE = '.env.b24test'
const APP_SCOPES = ['user_brief', 'crm', 'lists', 'placement', 'userfieldconfig', 'pull']

function readHook() {
  let raw
  try {
    raw = readFileSync(ENV_FILE, 'utf8')
  } catch {
    fail(`${ENV_FILE} not found. Create it with B24_HOOK=<inbound webhook url>. It is git-ignored.`)
  }
  const m = raw.match(/^\s*B24_HOOK=(.+)$/m)
  if (!m) fail(`B24_HOOK not found in ${ENV_FILE}`)
  let hook = m[1].trim().replace(/^["']|["']$/g, '')
  if (!hook.endsWith('/')) hook += '/'
  return hook
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

const hook = readHook()
// The webhook URL carries a token, so it must never reach stdout — a smoke log gets pasted into
// issues and chats. Everything below prints the portal host only.
const portal = new URL(hook).host
const redact = text => String(text).split(hook).join('<hook>')

async function call(method, params = {}) {
  const res = await fetch(hook + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params)
  })
  const json = await res.json().catch(() => ({}))
  return json
}

let failures = 0
const ok = message => console.log(`  ✓ ${message}`)
const bad = (message) => {
  failures += 1
  console.log(`  ✖ ${message}`)
}
const note = message => console.log(`  · ${message}`)

async function main() {
  console.log(`\n▶ REST smoke against ${portal}\n`)

  // 1. Scopes. The app asks for six; a portal that cannot grant one of them breaks a whole half of
  //    the feature — `lists` in particular, whose absence turns every List lookup into
  //    insufficient_scope.
  console.log('Scopes')
  const scope = await call('scope')
  const granted = Array.isArray(scope.result) ? scope.result : []
  if (!granted.length) bad(`scope returned nothing: ${redact(scope.error_description ?? JSON.stringify(scope))}`)
  for (const s of APP_SCOPES) {
    granted.includes(s) ? ok(`${s} available`) : bad(`${s} NOT available on this portal`)
  }

  // 2. crm.item.list envelope. The placement reads `result.items[0]` directly, with no guard for a
  //    differently shaped answer.
  console.log('\ncrm.item.list (the shape the placement reads)')
  const deals = await call('crm.item.list', { entityTypeId: 2, select: ['id', 'title'], start: 0 })
  if (Array.isArray(deals.result?.items)) {
    ok(`result.items is an array (${deals.result.items.length} on the first page)`)
  } else {
    bad(`result.items is not an array: ${redact(deals.error_description ?? JSON.stringify(deals).slice(0, 200))}`)
  }

  // 3. Where this portal actually keeps its Lists, and what happens when you ask the wrong section.
  //    The app used to send its own 'crm' | 'lists' discriminator as IBLOCK_TYPE_ID, so on a portal
  //    whose lists sit under bitrix_processes every lookup failed hard.
  console.log('\nLists sections (IBLOCK_TYPE_ID)')
  const found = []
  for (const type of ['lists', 'bitrix_processes', 'lists_socnet']) {
    const res = await call('lists.get', { IBLOCK_TYPE_ID: type })
    if (Array.isArray(res.result)) {
      note(`${type}: ${res.result.length} list(s)`)
      for (const l of res.result) found.push({ type, id: l.ID, name: l.NAME })
    } else {
      note(`${type}: ${redact(res.error_description ?? 'no access')}`)
    }
  }
  if (!found.length) {
    note('no Lists on this portal — the List half of the feature cannot be smoke-tested here')
  } else {
    const sample = found[0]
    ok(`lists live under "${sample.type}" here (e.g. #${sample.id} ${sample.name})`)

    const elements = await call('lists.element.get', {
      IBLOCK_TYPE_ID: sample.type, IBLOCK_ID: sample.id, SELECT: ['ID', 'NAME']
    })
    if (Array.isArray(elements.result)) {
      ok(`lists.element.get returns a bare array (${elements.result.length} element(s)) — the placement reads result[0]`)
    } else {
      bad(`lists.element.get is not an array: ${redact(elements.error_description ?? JSON.stringify(elements).slice(0, 200))}`)
    }

    // The negative case, which is the whole reason the iblock type is a setting: a wrong section is
    // a hard error, so a mis-set field looks broken rather than empty.
    const wrongType = sample.type === 'lists' ? 'bitrix_processes' : 'lists'
    const wrong = await call('lists.element.get', {
      IBLOCK_TYPE_ID: wrongType, IBLOCK_ID: sample.id, SELECT: ['ID', 'NAME']
    })
    if (wrong.error || wrong.error_description) {
      ok(`a wrong IBLOCK_TYPE_ID errors rather than returning nothing ("${redact(wrong.error_description)}")`)
    } else {
      bad(`a wrong IBLOCK_TYPE_ID did NOT error — the settings field may no longer be needed, re-check`)
    }
  }

  // 4. State the boundary explicitly, so nobody reads a green run as "the app works".
  console.log('\nOut of reach for a webhook (needs the app installed)')
  const uft = await call('userfieldtype.list')
  note(`userfieldtype.list → ${redact(uft.error_description ?? 'unexpectedly succeeded — re-check this assumption')}`)
  note('app.option.get/set, placement.* and the UF-type registration are application-context only')

  console.log(
    failures === 0
      ? '\n✓ REST facts hold on this portal\n'
      : `\n✖ ${failures} check(s) failed\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => fail(redact(error?.message ?? error)))
