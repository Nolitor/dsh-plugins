import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const [url, token] = process.argv.slice(2)
await page.goto(url + '?token=' + token, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(7000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.getByRole('button', { name: '계정 메뉴' }).click({ timeout: 8000 })
await page.getByText('설정', { exact: true }).first().click({ timeout: 8000 })
await page.getByText('오픈코드 V2', { exact: true }).first().click({ timeout: 8000 })
await page.waitForSelector('.ocv2Section', { timeout: 8000 })
const out = await page.evaluate(() => [...document.querySelectorAll('.ocv2Model')].map((row) => ({
  badge: row.querySelector('.ocv2Badge')?.textContent ?? '',
  badgeCls: row.querySelector('.ocv2Badge')?.className ?? '',
  name: row.querySelector('.ocv2ModelName')?.textContent ?? '',
  route: row.querySelector('.ocv2Route')?.textContent ?? '',
  plan: row.querySelector('.ocv2Plan')?.textContent ?? '',
})))
const tally = {}
for (const r of out) { const k = r.plan + ' | ' + r.badge; tally[k] = (tally[k] || 0) + 1 }
console.log('badge tally by plan:')
for (const [k, v] of Object.entries(tally).sort()) console.log(String(v).padStart(3), k)
console.log('--- every non-go row:')
for (const r of out.filter((x) => x.plan !== 'go')) console.log('  ', r.plan, '|', r.badge, '|', r.route)
await browser.close()
