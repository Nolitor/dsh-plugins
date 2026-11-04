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
// open the most recent session from the sidebar
const row = page.locator('[class*="session"], a[href*="session"], [role="button"]').filter({ hasText: /오픈코드 v2 플러그인 이슈 점검/ }).first()
if (await row.count()) await row.click().catch(() => {})
await page.waitForTimeout(6000)
const out = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  const leaf = all.filter((el) => el.childElementCount === 0 && (el.textContent ?? '').trim().length > 0)
  const hits = leaf.filter((el) => /캐시|cache|토큰|token|\$/.test(el.textContent ?? '')).slice(0, 25)
  const desc = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return { text: (el.textContent ?? '').trim().slice(0, 60), cls: String(el.className).slice(0, 50),
      parentCls: String(el.parentElement?.className ?? '').slice(0, 50),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }, fs: cs.fontSize, color: cs.color }
  }
  return { hits: hits.map(desc), bodyTail: document.body.innerText.split('\n').filter(Boolean).slice(-20) }
})
console.log(JSON.stringify(out, null, 1).slice(0, 5000))
await page.screenshot({ path: 'test/live/session-view.png' })
await browser.close()
