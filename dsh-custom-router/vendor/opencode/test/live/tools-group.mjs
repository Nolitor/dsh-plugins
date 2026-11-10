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
  const tools = document.querySelector('.uV2eYG_tools')
  const trailing = document.querySelector('.uV2eYG_trailing')
  const geo = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), display: cs.display, justify: cs.justifyContent, gap: cs.gap, children: [...el.children].map((c) => ({ cls: String(c.className).slice(0, 30), x: Math.round(c.getBoundingClientRect().x), w: Math.round(c.getBoundingClientRect().width) })) } }
  // Trial: does margin-left:auto inside tools push it to the right edge?
  const chip = document.querySelector('[data-ocv2-cost]')
  const before = chip ? Math.round(chip.getBoundingClientRect().x) : null
  let after = null
  if (chip) {
    chip.style.marginLeft = 'auto'
    after = Math.round(chip.getBoundingClientRect().x)
    chip.style.marginLeft = ''
  }
  return { row: geo(row), tools: geo(tools), trailing: geo(trailing), chipBefore: before, chipWithAutoMargin: after }
})
console.log(JSON.stringify(out, null, 1).slice(0, 3000))
await browser.close()
