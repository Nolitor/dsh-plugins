import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const reqs = []
page.on('response', async (r) => {
  if (!/cost\/session/.test(r.url())) return
  let b = ''; try { b = (await r.text()).slice(0, 200) } catch {}
  reqs.push({ status: r.status(), body: b })
})
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(8000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.getByText('DSH Plugins', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(2500)
// Try every session row until one shows stat anchors
const titles = ['오픈코드 v2 플러그인 이슈 점검', 'DSH 알파3 플러그인 검증 및 개선', '오픈코드 v2 스타일·플랜 점검']
const attempts = []
for (const t of titles) {
  await page.getByText(t, { exact: false }).first().click().catch(() => {})
  await page.waitForTimeout(7000)
  const info = await page.evaluate(() => ({
    url: location.href,
    session: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
    anchors: document.querySelectorAll('[data-composer-stat]').length,
    pill: (() => { const p = document.querySelector('[data-ocv2-cost]'); return p ? { text: p.textContent, cls: String(p.className) } : null })(),
    composerText: (document.querySelector('form, [class*="composer"], [class*="Composer"]')?.textContent ?? '').trim().slice(0, 120),
  }))
  attempts.push({ tried: t, ...info })
  if (info.anchors > 0) break
}
const final = await page.evaluate(() => {
  const own = document.querySelector('[data-ocv2-cost]')
  const host = document.querySelector('[data-composer-stat="usage"]')
  const desc = (el) => { if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { cls: String(el.className), fs: cs.fontSize, lh: cs.lineHeight, color: cs.color, pad: cs.padding, display: cs.display, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, html: el.outerHTML.slice(0, 260) } }
  return { own: desc(own), host: desc(host), rowHTML: own?.parentElement?.outerHTML.slice(0, 700) ?? null }
})
await page.screenshot({ path: 'test/live/pill-style.png' })
await browser.close()
console.log(JSON.stringify({ attempts, final, costRequests: reqs.slice(0, 3) }, null, 1).slice(0, 7000))
