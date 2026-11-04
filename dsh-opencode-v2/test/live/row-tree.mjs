import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(9000)

const out = await page.evaluate(() => {
  const row = document.querySelector('.uV2eYG_row')
  if (!row) return { row: false }
  const describe = (el, depth) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    const node = {
      tag: el.tagName, cls: String(el.className).slice(0, 44),
      x: Math.round(r.x), w: Math.round(r.width),
      display: cs.display, justify: cs.justifyContent, marginLeft: cs.marginLeft,
      text: (el.childElementCount === 0 ? (el.textContent ?? '').trim().slice(0, 24) : ''),
    }
    if (depth > 0) node.children = [...el.children].map((c) => describe(c, depth - 1))
    return node
  }
  return { row: true, x: Math.round(row.getBoundingClientRect().x), w: Math.round(row.getBoundingClientRect().width), tree: describe(row, 2) }
})
console.log(JSON.stringify(out, null, 1).slice(0, 5000))
await browser.close()
