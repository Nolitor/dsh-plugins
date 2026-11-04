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
// open a session that has turns
const row = page.locator('div, a, [role="button"]').filter({ hasText: /오픈코드 v2 플러그인 이슈 점검/ }).first()
if (await row.count()) await row.click().catch(() => {})
await page.waitForTimeout(9000)
const out = await page.evaluate(() => {
  // find ANY element whose rendered text mentions tokens with a number
  const all = [...document.querySelectorAll('div,span,p,button,section')]
  const hits = all.filter((el) => /\btok\b|캐시 적중|Cache hit/.test(el.textContent ?? '')).slice(0, 30)
  const leaves = hits.filter((el) => el.childElementCount <= 2)
  return leaves.slice(0, 12).map((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return {
      tag: el.tagName, cls: String(el.className).slice(0, 90),
      text: (el.textContent ?? '').trim().slice(0, 90),
      kids: el.childElementCount,
      visible: r.width > 0 && r.height > 0,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      parent: { tag: el.parentElement?.tagName, cls: String(el.parentElement?.className ?? '').slice(0, 70) },
      fs: cs.fontSize, color: cs.color,
      dataAttrs: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name + '=' + a.value).slice(0, 4),
    }
  })
})
console.log(JSON.stringify(out, null, 1).slice(0, 6000))
console.log('BODY-TOK-LINES:', JSON.stringify(document ? undefined : null))
await browser.close()
