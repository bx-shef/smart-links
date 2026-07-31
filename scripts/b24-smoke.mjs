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

function fail(message) {
  // Only ever called with text this file authored, or text already put through `redact`.
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

/**
 * Read and validate the webhook, never echoing it.
 *
 * The parse lives here rather than at the call site because `new URL(bad)` throws a TypeError
 * carrying an `input` property set to the whole string — and Node's uncaught-exception printer
 * dumps an error's own properties, so a mistyped scheme (exactly what you get pasting a webhook out
 * of the Bitrix24 UI) printed the token to stderr. That happened before `redact` existed, at module
 * scope, where nothing could have caught it.
 */
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

  let parsed
  try {
    parsed = new URL(hook)
  } catch {
    fail(`B24_HOOK in ${ENV_FILE} is not a valid URL. Expected https://<portal>/rest/<user>/<token>/ — value not shown.`)
  }
  if (parsed.protocol !== 'https:') {
    fail(`B24_HOOK must be https — value not shown.`)
  }
  return { hook, host: parsed.host }
}

const { hook, host: portal } = readHook()
// The webhook URL carries a token, so it must never reach stdout or stderr — a smoke log gets
// pasted into issues and chats. Everything below prints the portal host only.
const redact = text => String(text).split(hook).join('<hook>')

/** Milliseconds before a portal that stopped answering is treated as a failure rather than a hang. */
const REQUEST_TIMEOUT_MS = 15_000

async function call(method, params = {}) {
  let res
  try {
    res = await fetch(hook + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    // undici keeps the URL out of `message`/`cause`, so this is safe to surface — and the cause is
    // where the actual reason (DNS, TLS, proxy) lives.
    return { transportError: redact(error?.cause?.message ?? error?.message ?? error) }
  }
  // Parse the body even on a non-2xx: Bitrix24 answers a REST-level refusal with an error status
  // AND a JSON `{error, error_description}`, and that description is the whole point of several
  // checks below. Only a body that is not JSON at all is a transport problem — and then the status
  // alone is reported, never the body, which can be a portal HTML page echoing the request.
  const json = await res.json().catch(() => null)
  if (json && typeof json === 'object') {
    return json
  }
  return { transportError: `HTTP ${res.status}, response was not JSON` }
}

/** Why a call produced nothing usable — a transport problem and a portal refusal are not the same. */
const why = answer => answer.transportError
  ? `transport: ${answer.transportError}`
  : redact(answer.error_description ?? answer.error ?? 'empty answer')

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
  // Reported, never failed. `scope` through an inbound webhook returns the WEBHOOK's own grant —
  // whatever boxes were ticked when it was created — not what the portal is able to grant the
  // application. Failing the run on a missing `placement` would be crying wolf about a setting that
  // has nothing to do with the app, on every run, which is how a smoke tool stops being read.
  note("this is the webhook's own grant, not the application's — a miss here may just be an unticked box")
  const scope = await call('scope')
  const granted = Array.isArray(scope.result) ? scope.result : []
  if (!granted.length) {
    note(`scope returned nothing (${why(scope)}) — cannot compare`)
  } else {
    const absent = APP_SCOPES.filter(s => !granted.includes(s))
    absent.length === 0
      ? ok(`all six app scopes present in this webhook's grant`)
      : note(`not in this webhook's grant: ${absent.join(', ')} — re-check on the installed app`)
  }

  // 2. crm.item.list envelope. The placement reads `result.items[0]` directly, with no guard for a
  //    differently shaped answer.
  console.log('\ncrm.item.list (the shape the placement reads)')
  const deals = await call('crm.item.list', { entityTypeId: 2, select: ['id', 'title'], start: 0 })
  if (Array.isArray(deals.result?.items)) {
    ok(`result.items is an array (${deals.result.items.length} on the first page)`)
  } else {
    bad(`result.items is not an array (${why(deals)})`)
  }

  // 3. Where this portal actually keeps its Lists, and what happens when you ask the wrong section.
  //    The app used to send its own 'crm' | 'lists' discriminator as IBLOCK_TYPE_ID, so on a portal
  //    whose lists sit under bitrix_processes every lookup failed hard.
  console.log('\nLists sections (IBLOCK_TYPE_ID)')
  const found = []
  // `lists_socnet` is deliberately not enumerated: `lists.get` requires SOCNET_GROUP_ID for
  // workgroup lists and errors without it, so iterating it would only ever print an access error
  // and imply a census this script cannot take.
  for (const type of ['lists', 'bitrix_processes']) {
    const res = await call('lists.get', { IBLOCK_TYPE_ID: type })
    if (Array.isArray(res.result)) {
      note(`${type}: ${res.result.length} list(s)`)
      for (const l of res.result) found.push({ type, id: l.ID, name: l.NAME })
    } else {
      note(`${type}: ${why(res)}`)
    }
  }
  note('lists_socnet not checked — workgroup lists need a group id this script does not have')
  if (!found.length) {
    note('no Lists found in the sections checked — the List half of the feature is not covered here')
  } else {
    const sample = found[0]
    ok(`lists live under "${sample.type}" here (e.g. #${sample.id} ${sample.name})`)

    const elements = await call('lists.element.get', {
      IBLOCK_TYPE_ID: sample.type, IBLOCK_ID: sample.id, SELECT: ['ID', 'NAME']
    })
    if (Array.isArray(elements.result)) {
      ok(`lists.element.get returns a bare array (${elements.result.length} element(s)) — the placement reads result[0]`)
    } else {
      bad(`lists.element.get is not an array (${why(elements)})`)
    }

    // The negative case, which is the whole reason the iblock type is a setting: a wrong section is
    // a hard error, so a mis-set field looks broken rather than empty.
    const wrongType = sample.type === 'lists' ? 'bitrix_processes' : 'lists'
    const wrong = await call('lists.element.get', {
      IBLOCK_TYPE_ID: wrongType, IBLOCK_ID: sample.id, SELECT: ['ID', 'NAME']
    })
    if (wrong.transportError) {
      // Do not read a call that never happened as evidence about the portal.
      bad(`could not test a wrong IBLOCK_TYPE_ID (${why(wrong)})`)
    } else if (wrong.error || wrong.error_description) {
      ok(`a wrong IBLOCK_TYPE_ID errors rather than returning nothing ("${why(wrong)}")`)
    } else {
      bad('a wrong IBLOCK_TYPE_ID did NOT error — the settings field may no longer be needed, re-check')
    }
  }

  // 4. State the boundary explicitly, so nobody reads a green run as "the app works".
  console.log('\nOut of reach for a webhook (needs the app installed)')
  const uft = await call('userfieldtype.list')
  note(`userfieldtype.list → ${uft.error || uft.error_description || uft.transportError ? why(uft) : 'unexpectedly succeeded — re-check this assumption'}`)
  note('app.option.get/set, placement.* and the UF-type registration are application-context only')

  console.log(
    failures === 0
      ? '\n✓ REST facts hold on this portal\n'
      : `\n✖ ${failures} check(s) failed\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => fail(redact(error?.cause?.message ?? error?.message ?? error)))
