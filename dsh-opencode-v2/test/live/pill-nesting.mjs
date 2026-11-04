import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)

const out = await page.evaluate(() => {
  // Reproduce the host's REAL structure using the real hashed class names that
  // the live stylesheet defines, then compare flat vs nested rendering.
  const HOST_ANCHOR = 'bOPqQW_anchor', HOST_PILL = 'bOPqQW_pill', HOST_LABEL = 'bOPqQW_label'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;font-size:16px'
  document.body.appendChild(row)

  const host = document.createElement('span')
  host.className = HOST_ANCHOR
  host.setAttribute('data-composer-stat', 'usage')
  const hp = document.createElement('span'); hp.className = HOST_PILL
  const hl = document.createElement('span'); hl.className = HOST_LABEL
  hl.textContent = '141M tok · 캐시 적중 99%'
  hp.appendChild(hl); host.appendChild(hp); row.appendChild(host)

  // A) what we currently do: flat pill appended to the row
  const flat = document.createElement('span')
  flat.className = HOST_PILL
  flat.textContent = '무료 · 플랜 $0.13'
  row.appendChild(flat)

  // B) the fix: full anchor > pill > label nesting, as the host renders it
  const nested = document.createElement('span')
  nested.className = HOST_ANCHOR
  const np = document.createElement('span'); np.className = HOST_PILL
  const nl = document.createElement('span'); nl.className = HOST_LABEL
  nl.textContent = '무료 · 플랜 $0.13'
  np.appendChild(nl); nested.appendChild(np); row.appendChild(nested)

  const m = (el) => { const cs = getComputedStyle(el); return { fs: cs.fontSize, lh: cs.lineHeight, color: cs.color, pad: cs.padding, display: cs.display, h: Math.round(el.getBoundingClientRect().height) } }
  return {
    hostPill: m(hp),
    flatPill: m(flat),
    nestedPill: m(np),
    hostAnchor: m(host),
    nestedAnchor: m(nested),
    rowHTML: row.innerHTML.slice(0, 400),
  }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: 'test/live/pill-compare.png', clip: { x: 0, y: 0, width: 900, height: 120 } })
await browser.close()
