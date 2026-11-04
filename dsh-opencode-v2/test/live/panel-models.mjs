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
await page.waitForTimeout(9000)

// Where is the chip relative to the model selector?
const layout = await page.evaluate(() => {
  const chip = document.querySelector('[data-ocv2-cost]')
  const model = [...document.querySelectorAll('button')].find((b) => /V4\.1 Flash|DeepSeek V4/i.test(b.textContent ?? ''))
  const cr = chip?.getBoundingClientRect(), mr = model?.getBoundingClientRect()
  return {
    chipText: chip?.textContent ?? null,
    chipX: cr ? Math.round(cr.x) : null,
    chipY: cr ? Math.round(cr.y) : null,
    modelX: mr ? Math.round(mr.x) : null,
    modelY: mr ? Math.round(mr.y) : null,
    chipBeforeModel: Boolean(cr && mr && (cr.x < mr.x || (Math.abs(cr.y - mr.y) < 6 && cr.x < mr.x))),
  }
})
// Open the panel
await page.locator('[data-ocv2-cost]').click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(4000)
const panel = await page.evaluate(() => {
  const p = document.querySelector('[data-ocv2-plan]')
  return p ? { text: p.innerText.replace(/\n/g, ' | '), models: [...p.querySelectorAll('.ocv2PlanModel')].map((m) => m.innerText.replace(/\n/g, ' ')), w: Math.round(p.getBoundingClientRect().width) } : null
})
await page.screenshot({ path: 'test/live/panel-models.png' })
await browser.close()
console.log(JSON.stringify({ layout, panel }, null, 1).slice(0, 3500))
