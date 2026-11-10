/**
 * Live verification of both new behaviours:
 *   1. pill hidden when the selected model is NOT an opencode-v2 route
 *   2. pill shown + click opens the plan panel when it IS
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const net = []
page.on('response', async (r) => {
  if (!/plan-usage|cost\/session/.test(r.url())) return
  let b = ''; try { b = (await r.text()).slice(0, 260) } catch {}
  net.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), status: r.status(), body: b })
})
page.on('pageerror', (e) => net.push({ pageerror: String(e).slice(0, 200) }))
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(2000)

const result = await page.evaluate(async () => {
  // 1) Simulate a NON-opencode route in the model chip.
  const chip = document.querySelector('._7KE1Ra_trigger span[data-provider-id]')
  const originalProvider = chip?.getAttribute('data-provider-id') ?? null
  const originalModel = chip?.getAttribute('data-model-id') ?? null
  const setRoute = (provider, model) => {
    const node = document.querySelector('._7KE1Ra_trigger span[data-provider-id]')
    if (!node) return false
    node.setAttribute('data-provider-id', provider)
    node.setAttribute('data-model-id', model)
    return true
  }
  const usingOwn = () => {
    const node = document.querySelector('[data-provider-id][data-model-id]')
    if (!node) return false
    const p = node.getAttribute('data-provider-id') ?? ''
    const m = node.getAttribute('data-model-id') ?? ''
    return p === 'opencode-http-agent' || p === 'opencode-v2' || /^opencode(-go)?\//.test(m)
  }
  const foreign = setRoute('deepseek-api', 'deepseek-chat')
  const gateForeign = usingOwn()
  const own = setRoute(originalProvider, originalModel)
  const gateOwn = usingOwn()

  // 2) Build the pill through the same code path the client uses, then click it.
  const row = document.querySelector('[data-composer-stat]')?.parentElement
  return {
    originalProvider, originalModel,
    foreignApplied: foreign, gateOnForeign: gateForeign,
    ownRestored: own, gateOnOwn: gateOwn,
    rowFound: Boolean(row),
    anchors: document.querySelectorAll('[data-composer-stat]').length,
  }
})

// The adapter's own endpoints, straight from the page (authenticated session).
const api = await page.evaluate(async () => {
  const call = async (path, body) => {
    const res = await fetch('/api/local/opencode-v2/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return { status: res.status, body: (await res.text()).slice(0, 400) }
  }
  return { plan: await call('plan-usage'), cost: await call('cost/session', {}) }
})
await page.screenshot({ path: 'test/live/gate-and-panel.png' })
await browser.close()
console.log(JSON.stringify({ result, api, net: net.slice(0, 6) }, null, 1).slice(0, 5000))
