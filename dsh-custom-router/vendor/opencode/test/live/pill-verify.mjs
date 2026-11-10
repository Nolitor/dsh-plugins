/**
 * Verify the pill against the REAL host markup in a live browser.
 *
 * Builds the row using the hashed class names the running stylesheet actually
 * defines, runs the client's exact paint sequence, and compares computed style
 * against the host pill beside it.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)

const out = await page.evaluate(() => {
  // Real row as the host renders it, positioned where the composer row sits.
  const row = document.createElement('div')
  row.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;display:flex;gap:8px;align-items:center;background:#fff;padding:6px 10px;border-radius:8px;font-size:16px'
  const host = document.createElement('span')
  host.className = 'bOPqQW_anchor'; host.setAttribute('data-composer-stat', 'usage')
  const hp = document.createElement('span'); hp.className = 'bOPqQW_pill'
  const hl = document.createElement('span'); hl.className = 'bOPqQW_label'; hl.textContent = '141M tok · 캐시 적중 99%'
  hp.appendChild(hl); host.appendChild(hp); row.appendChild(host)
  document.body.appendChild(row)

  // The client's exact sequence.
  const paint = (text, title) => {
    const anchor = document.querySelector('[data-composer-stat]')
    const hostRow = anchor?.parentElement
    const current = hostRow.querySelector('[data-ocv2-cost]')
    if (current) { const p = current.querySelector('span') ?? current; const l = p.querySelector('span') ?? p; l.textContent = text; current.title = title; return current }
    let found = null
    for (const c of hostRow.querySelectorAll('[data-composer-stat]')) {
      const p = c.querySelector('span'); const l = p?.querySelector('span')
      if (c.className && p?.className && l?.className) { found = { a: c, p, l }; break }
    }
    if (!found) return null
    const w = document.createElement('span'); w.className = found.a.className; w.setAttribute('data-ocv2-cost','1'); w.title = title
    const p = document.createElement('span'); p.className = found.p.className
    const l = document.createElement('span'); l.className = found.l.className; l.textContent = text
    p.appendChild(l); w.appendChild(p); hostRow.appendChild(w); return w
  }
  paint('무료 · 플랜 $0.13058268', '이 세션 요청 8건의 실제 비용과 플랜 소진액')
  const own = document.querySelector('[data-ocv2-cost]')
  const m = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { fs: cs.fontSize, lh: cs.lineHeight, color: cs.color, pad: cs.padding, h: Math.round(r.height), text: el.textContent.trim() } }
  return { hostPill: m(hp), ownPill: m(own.querySelector('span')), ownWrapper: m(own), html: own.outerHTML.slice(0, 260), rowText: row.innerText }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: 'test/live/pill-final.png', clip: { x: 0, y: 800, width: 900, height: 100 } })
await browser.close()
