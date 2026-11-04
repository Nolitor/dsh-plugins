/**
 * Render the panel markup with the REAL host CSS and the real payload shape,
 * then screenshot it. Proves the visual result independent of the restart.
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
  // Pull the plugin's own injected stylesheet so the panel uses its real CSS.
  const cssTag = document.querySelector('style[data-plugin-css*="opencode-v2"]')
  const cssText = cssTag ? cssTag.textContent : ''

  // The pill, structured exactly as the host's.
  const row = document.createElement('div')
  row.style.cssText = 'position:fixed;left:24px;bottom:20px;z-index:99998;display:flex;gap:8px;align-items:center;font-size:16px'
  const host = document.createElement('span'); host.className = 'bOPqQW_anchor'; host.setAttribute('data-composer-stat','usage')
  const hp = document.createElement('span'); hp.className = 'bOPqQW_pill'
  const hl = document.createElement('span'); hl.className = 'bOPqQW_label'; hl.textContent = '141M tok · 캐시 적중 99%'
  hp.appendChild(hl); host.appendChild(hp); row.appendChild(host)
  const own = document.createElement('span'); own.className = 'bOPqQW_anchor'; own.setAttribute('data-ocv2-cost','1')
  own.title = '이 세션 요청 25건의 실제 비용과 플랜 소진액 — 클릭하면 플랜 사용량'
  const op = document.createElement('span'); op.className = 'bOPqQW_pill'
  const ol = document.createElement('span'); ol.className = 'bOPqQW_label'; ol.textContent = '무료 · 플랜 $0.09471759'
  op.appendChild(ol); own.appendChild(op); row.appendChild(own)
  document.body.appendChild(row)

  // The panel, built with the plugin's own classes from its real stylesheet.
  const panel = document.createElement('div')
  panel.className = 'ocv2PlanPanel'; panel.setAttribute('data-ocv2-plan','1')
  panel.innerHTML = '<div class="ocv2PlanHead"><span>Go 플랜 사용량</span><button type="button" class="ocv2PlanRefresh">새로고침</button></div>'
  const body = document.createElement('div'); body.className = 'ocv2PlanBody'
  const windows = [['5시간',3,1793731018000],['7일',3,1794182400000],['30일',27,1794998310000]]
  for (const [label,pct,reset] of windows) {
    const r = document.createElement('div'); r.className = 'ocv2PlanRow'
    r.innerHTML = '<div class="ocv2PlanRowTop"><span>' + label + '</span><span class="ocv2PlanPct">' + pct + '%</span></div>'
    const bar = document.createElement('div'); bar.className = 'ocv2PlanBar'
    const fill = document.createElement('div'); fill.className = 'ocv2PlanFill'; fill.style.width = pct + '%'
    bar.appendChild(fill); r.appendChild(bar)
    const rs = document.createElement('div'); rs.className = 'ocv2PlanReset'
    rs.textContent = new Date(reset).toLocaleString() + ' 초기화'
    r.appendChild(rs); body.appendChild(r)
  }
  panel.appendChild(body); document.body.appendChild(panel)

  const m = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return { fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, w: Math.round(b.width), h: Math.round(b.height) } }
  return {
    stylesheetInjected: cssText.length > 0, cssBytes: cssText.length,
    panel: m(panel), pillOwn: m(op), pillHost: m(hp),
    fillWidth: panel.querySelector('.ocv2PlanFill').style.width,
    panelText: panel.innerText.replace(/\n/g, ' | '),
  }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: 'test/live/panel-render.png', clip: { x: 0, y: 380, width: 1440, height: 520 } })
await browser.close()
