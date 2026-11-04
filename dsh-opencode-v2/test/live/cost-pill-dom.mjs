/**
 * Real-browser check of the pill DOM logic, independent of the server route.
 *
 * Builds the composer row the way dsh-client-ui-chat renders it
 * (span[data-composer-stat] children carrying the host pill class), runs the
 * same append/update/remove sequence the module performs, and reports the
 * computed style so "borrowed the host class" is a measured fact.
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
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(8000)
const dismiss = page.getByRole('button', { name: '나중에' })
if (await dismiss.count()) await dismiss.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})

const result = await page.evaluate(() => {
  // 1) A row shaped like the host's own composer status area.
  const row = document.createElement('div')
  row.id = 'probe-row'
  row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;font-size:12px'
  const hostPillClass = 'ocv2ProbePill'
  const style = document.createElement('style')
  style.textContent = '.' + hostPillClass + '{font-size:12px;line-height:18px;color:rgb(129,133,140);display:inline-flex;align-items:center;gap:4px}'
  document.head.appendChild(style)
  for (const stat of ['activity', 'usage']) {
    const anchor = document.createElement('span')
    anchor.setAttribute('data-composer-stat', stat)
    const inner = document.createElement('span')
    inner.className = hostPillClass
    inner.textContent = stat === 'usage' ? '141M tok · 캐시 적중 99%' : '13턴 553단계'
    anchor.appendChild(inner)
    row.appendChild(anchor)
  }
  document.body.appendChild(row)

  // 2) The exact sequence lib/cost-pill.js performs.
  const paint = (text, title) => {
    const host = document.querySelector('[data-composer-stat]')?.parentElement
    if (!host) return null
    const current = host.querySelector('[data-ocv2-cost]')
    if (text === '') { if (current) current.remove(); return null }
    const pill = current ?? document.createElement('span')
    if (!current) {
      for (const anchor of host.querySelectorAll('[data-composer-stat]')) {
        const inner = anchor.querySelector?.('span')
        if (inner?.className) { pill.className = inner.className; break }
      }
      pill.setAttribute('data-ocv2-cost', '1')
      host.appendChild(pill)
    }
    pill.textContent = text
    pill.title = title
    return pill
  }
  const first = paint('무료 · 플랜 $0.0000279', 'session cost')
  const second = paint('$0.00412 · 플랜 $0.001', 'session cost')
  const cs = getComputedStyle(first)
  const before = { count: row.querySelectorAll('[data-ocv2-cost]').length, sameNode: first === second,
    text: first.textContent, cls: first.className, fs: cs.fontSize, color: cs.color,
    rowText: row.innerText.replace(/\n/g, ' | ') }
  paint('', '')
  return { ...before, afterRemove: row.querySelectorAll('[data-ocv2-cost]').length }
})
await page.screenshot({ path: 'test/live/cost-pill-probe.png', clip: { x: 0, y: 700, width: 1440, height: 300 } })
await browser.close()
console.log(JSON.stringify(result, null, 1))
