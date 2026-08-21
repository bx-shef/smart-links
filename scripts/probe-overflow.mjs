// Horizontal-overflow probe at a narrow viewport (pattern from the reference, its #523).
//
// WHY A SEPARATE SCRIPT. The project rule is «no horizontal scrolling; long strings wrap, they do
// not get cut into nowhere». A violation is invisible to tests (the markup template is valid) and
// easy to misread on a screenshot: the page does not scroll, it just clips content at the edge.
// The reference found its real offender this way — a flex container without `min-w-0` grown to
// 518 px by one long label on a 375 px screen.
//
// The script FIXES nothing and says nothing about beauty: it answers one question — which element
// dictates a width wider than the screen. Trick: shrink the suspect to 300 px and see which of
// its descendants stays wide anyway. That names the CULPRIT, not everyone who merely fills the
// width they were given.
//
//   pnpm generate && pnpm probe:overflow                      # default routes at 375 px
//   pnpm probe:overflow /app /handler/uf.smart-link --width 320
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveChromium } from './lib/chromium.mjs'
import { resolveSafePath } from './lib/staticPath.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC_DIR = join(ROOT, '.output', 'public')
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
}

const args = process.argv.slice(2)
const widthArg = args.indexOf('--width')
const WIDTH = widthArg === -1 ? 375 : Number(args[widthArg + 1]) || 375
// The `--width` VALUE is excluded only when the flag is present: with `widthArg === -1` the
// expression `widthArg + 1` is 0, and the first passed route silently fell out of the list
// (a real bug the reference shipped and fixed).
const routes = args.filter((a, i) => a.startsWith('/') && (widthArg === -1 || i !== widthArg + 1))
const ROUTES = routes.length ? routes : ['/app', '/handler/uf.smart-link', '/slider/app-options', '/slider/feedback']

const server = createServer(async (req, res) => {
  // The traversal lock is the shared pure function (scripts/lib/staticPath.mjs), guarded by
  // behavior in tests/staticPath.test.ts — an inline copy could only be guarded textually, and
  // text cannot see an inverted condition.
  const filePath = resolveSafePath(PUBLIC_DIR, req.url || '/')
  if (filePath === null) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
// Loopback only — see screenshot.mjs for why 0.0.0.0 would be a hole, not a convenience.
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch({ executablePath: await resolveChromium() })
let offenders = 0
try {
  for (const route of ROUTES) {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } })
    await page.goto(`http://127.0.0.1:${port}${route.endsWith('/') ? route : `${route}/`}`, { waitUntil: 'networkidle' })
    const found = await page.evaluate((vw) => {
      const wide = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().width > vw + 1)
      const out = []
      for (const el of wide) {
        // The culprit is wider than ITS OWN PARENT — everyone else just fills an imposed width.
        const parent = el.parentElement
        if (parent && el.getBoundingClientRect().width <= parent.getBoundingClientRect().width + 1) continue
        // Shrink the culprit and see who inside refuses to compress.
        const prev = el.style.width
        el.style.width = '300px'
        const stuck = [...el.querySelectorAll('*')]
          .filter(k => k.getBoundingClientRect().width > 320)
          .filter(k => ![...k.children].some(c => c.getBoundingClientRect().width > 320))
          .slice(0, 3)
          .map(k => ({ tag: k.tagName.toLowerCase(), cls: (k.className || '').toString().slice(0, 80), text: (k.textContent || '').trim().slice(0, 45) }))
        el.style.width = prev
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          width: Math.round(el.getBoundingClientRect().width),
          stuck
        })
      }
      return { scrollWidth: document.documentElement.scrollWidth, out: out.slice(0, 8) }
    }, WIDTH)
    await page.close()

    if (!found.out.length) {
      console.log(`\x1b[32m✓\x1b[0m ${route} @ ${WIDTH}px — ничего не выходит за экран`)
      continue
    }
    offenders += found.out.length
    console.error(`\x1b[31m✗\x1b[0m ${route} @ ${WIDTH}px — шире экрана:`)
    for (const o of found.out) {
      console.error(`   ${o.tag}.${o.cls} → ${o.width}px`)
      for (const s of o.stuck) console.error(`     не даёт сжаться: ${s.tag}.${s.cls} «${s.text}»`)
    }
  }
} finally {
  await browser.close()
  server.close()
}
process.exitCode = offenders ? 1 : 0
