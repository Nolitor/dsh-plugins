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
  const chip = document.querySelector('[data-ocv2-cost]')
  const geo = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { cls: String(el.className).slice(0,30), x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), display: cs.display, flex: cs.flex, justify: cs.justifyContent, gap: cs.gap, ml: cs.marginLeft } }
  return {
    row: geo(row),
    rowChildren: row ? [...row.children].map(geo) : null,
    tools: geo(tools),
    toolsChildren: tools ? [...tools.children].map((c) => ({ ...geo(c), kids: c.childElementCount })) : null,
    chip: geo(chip),
    chipParent: chip ? geo(chip.parentElement) : null,
    chipParentOfParent: chip ? geo(chip.parentElement.parentElement) : null,
  }
})
console.log(JSON.stringify(out, null, 1).slice(0, 4000))
await browser.close()
