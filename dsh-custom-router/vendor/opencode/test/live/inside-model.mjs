import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(10000)

const measure = async (label) => page.evaluate((tag) => {
  const chip = document.querySelector('[data-ocv2-cost]')
  const modelBtn = [...document.querySelectorAll('button')].find((b) => /V4\.1 Flash|DeepSeek V4/i.test(b.textContent ?? ''))
  const mr = modelBtn?.getBoundingClientRect()
  const cr = chip?.getBoundingClientRect()
  return {
    tag,
    chipFound: Boolean(chip),
    chipText: chip?.textContent ?? null,
    chipRect: cr ? { x: Math.round(cr.x), right: Math.round(cr.right), y: Math.round(cr.y) } : null,
    modelRect: mr ? { x: Math.round(mr.x), right: Math.round(mr.right) } : null,
    insideModelChip: Boolean(chip && modelBtn && modelBtn.contains(chip)),
    modelBtnText: modelBtn?.textContent?.trim().slice(0, 60) ?? null,
  }
}, label)

const wide = await measure('width-1440')
await page.setViewportSize({ width: 1000, height: 900 })
await page.waitForTimeout(2500)
const narrow = await measure('width-1000')
await page.setViewportSize({ width: 1440, height: 1000 })
await page.waitForTimeout(2000)
await page.screenshot({ path: 'test/live/inside-model.png', clip: { x: 800, y: 540, width: 640, height: 120 } })
await browser.close()
console.log(JSON.stringify({ wide, narrow }, null, 1).slice(0, 3000))
