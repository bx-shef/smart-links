// Генерация растровых иконок из мастера public/favicon.svg.  Запуск: pnpm icons
//
// Зачем: Маркет требует иконку решения — квадрат 250–650 px, JPEG или PNG **без прозрачного фона**
// («Требования к оформлению», §1В п.10). Мастер — скруглённая плитка, поэтому у прямого экспорта
// углы прозрачны, и отказ пришёл бы на модерации, когда заявка уже подана. В соседних приложениях
// издателя эта дыра вскрывалась именно так.
//
// Выход: icon-market-512.png (непрозрачная иконка карточки) + icons.stamp.json.
// Штамп хэширует ИСХОДНИК, а не только результат: хэш одного вывода сравнивал бы два файла, которые
// пишет один и тот же скрипт, — правка знака без прогона генератора оставила бы их одинаково
// устаревшими и согласованными между собой.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveChromium } from './lib/chromium.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PUB = join(ROOT, 'public')

/** Цвет плитки знака — им заливается непрозрачная подложка, чтобы углы стали квадратными. */
const PLATE = '#0b1220'

async function render(page, svg, size, { background = 'transparent' } = {}) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; } body { width: ${size}px; height: ${size}px; background: ${background}; }
    img { width: ${size}px; height: ${size}px; }
  </style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(html, { waitUntil: 'load' })
  return page.screenshot({ type: 'png', omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } })
}

const svg = await readFile(join(PUB, 'favicon.svg'), 'utf8')
const browser = await chromium.launch({ executablePath: await resolveChromium() })
try {
  await mkdir(PUB, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })

  const market = await render(page, svg, 512, { background: PLATE })
  await writeFile(join(PUB, 'icon-market-512.png'), market)

  const sha = b => createHash('sha256').update(b).digest('hex')
  await writeFile(join(PUB, 'icons.stamp.json'), `${JSON.stringify({
    source: sha(svg),
    iconMarket512: sha(market)
  }, null, 2)}\n`)

  console.log('✓ icon-market-512.png, icons.stamp.json')
} finally {
  await browser.close()
}
