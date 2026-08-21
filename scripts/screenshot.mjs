// Headless screenshots of the built SSG site — the agent's "eyes" for visual verification.
// Serves .output/public on an ephemeral loopback port and captures each route × viewport.
//
// Usage:
//   pnpm generate && pnpm screenshot          # all prerendered routes below
//   pnpm screenshot /app /privacy             # only these routes
//
// The browser is the pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH) via playwright-core — no
// `playwright install`, no bundled download.
//
// One theme only, deliberately: the app pins itself light (b24ui colorMode:false, layouts stamp
// the class), so a `colorScheme: 'dark'` context changes nothing real and two identical PNGs per
// route would only hide the day dark support actually lands (that day is gated on a live-portal
// check — see CLAUDE.md, тема).
import { createServer } from 'node:http'
import { readFile, mkdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveChromium } from './lib/chromium.mjs'
import { resolveSafePath } from './lib/staticPath.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC_DIR = join(ROOT, '.output', 'public')
const OUT_DIR = join(ROOT, 'screenshots')

// Default = every prerendered route (nuxt.config `nitro.prerender.routes`). In-portal pages
// render standalone too: useB24().init() no-ops outside a frame and the pages show their shells.
const DEFAULT_ROUTES = ['/', '/privacy', '/app', '/install', '/handler/uf.smart-link', '/slider/app-options', '/slider/feedback']
const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROUTES
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 }
]

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
}

async function ensurePublic() {
  try {
    await stat(PUBLIC_DIR)
  } catch {
    console.error('✖ .output/public not found — run `pnpm generate` first.')
    process.exit(1)
  }
}

// Minimal static file server over the SSG output (no extra deps).
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      // The traversal lock is the shared pure function, not an inline check — see its module
      // docblock for why an inline copy cannot be guarded meaningfully.
      let filePath = resolveSafePath(PUBLIC_DIR, req.url || '/')
      if (filePath === null) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      if ((await stat(filePath).catch(() => null))?.isDirectory()) {
        filePath = join(filePath, 'index.html')
      }
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  return new Promise((resolve, reject) => {
    // Loopback ONLY: without a host Node listens on 0.0.0.0, and for the run's duration the port
    // is visible to anything that can reach this machine — while the server hands out files the
    // process can read. An ephemeral unprinted port is obscurity, not protection.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not determine server port'))
        return
      }
      resolve({ server, port: addr.port })
    })
  })
}

async function run() {
  await ensurePublic()
  await mkdir(OUT_DIR, { recursive: true })
  const { server, port } = await startServer()
  const browser = await chromium.launch({ executablePath: await resolveChromium() })

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage()
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle', timeout: 15_000 })
        const slug = route === '/' ? 'index' : route.replace(/\W+/g, '-').replace(/^-|-$/g, '')
        const file = join(OUT_DIR, `${slug}.${vp.name}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`✓ ${file.replace(ROOT, '.')}`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
