import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto('https://nolitor/?token=' + process.argv[2], { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(8000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
const row = page.locator('div, a, [role="button"]').filter({ hasText: /오픈코드 v2 플러그인 이슈 점검/ }).first()
if (await row.count()) await row.click().catch(() => {})
await page.waitForTimeout(9000)
const out = await page.evaluate(() => {
  const attrs = new Set()
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes ?? []) {
      if (/session/i.test(a.name) || /^session-/.test(a.value)) attrs.add(a.name + '=' + a.value.slice(0, 60))
    }
  }
  return { url: location.href, sessionAttrs: [...attrs].slice(0, 20), hasStat: document.querySelectorAll('[data-composer-stat]').length }
})
console.log(JSON.stringify(out, null, 1).slice(0, 2500))
await browser.close()
