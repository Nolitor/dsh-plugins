/**
 * Full diagnostic: console errors, network calls to cost/session, session id,
 * and whether the pill exists. No assumptions.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')

const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })

const consoleMsgs = []
const network = []
page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 300) }))
page.on('pageerror', (e) => consoleMsgs.push({ type: 'PAGEERROR', text: String(e).slice(0, 400) }))
page.on('request', (r) => { if (/cost|model-settings/.test(r.url())) network.push({ phase: 'req', method: r.method(), url: r.url().replace(/^https:\/\/[^/]+/, '') }) })
page.on('response', async (r) => {
  if (!/cost|model-settings/.test(r.url())) return
  let body = ''
  try { body = (await r.text()).slice(0, 400) } catch { body = '(unreadable)' }
  network.push({ phase: 'res', status: r.status(), url: r.url().replace(/^https:\/\/[^/]+/, ''), body })
})

await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(8000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.getByText('DSH Plugins', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.getByText('오픈코드 v2 플러그인 이슈 점검', { exact: false }).first().click().catch(() => {})
// wait long enough for the 15s poll plus first paint
await page.waitForTimeout(25000)

const dom = await page.evaluate(() => ({
  sessionId: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
  statAnchors: [...document.querySelectorAll('[data-composer-stat]')].map((e) => e.getAttribute('data-composer-stat')),
  rowExists: Boolean(document.querySelector('[data-composer-stat]')?.parentElement),
  ownPill: (() => { const p = document.querySelector('[data-ocv2-cost]'); return p ? { text: p.textContent, title: p.getAttribute('title'), parentCls: String(p.parentElement?.className).slice(0,60) } : null })(),
  bodyMentions: document.body.innerText.split('\n').filter((l) => /tok|캐시|\$|플랜/.test(l)).slice(0, 8),
}))
await page.screenshot({ path: 'test/live/diag.png' })
await browser.close()
console.log(JSON.stringify({ dom, network, errors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'PAGEERROR').slice(0, 10) }, null, 1).slice(0, 7000))
