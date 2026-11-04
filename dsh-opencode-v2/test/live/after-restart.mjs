import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const log = []
page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text().slice(0, 200)) })
page.on('pageerror', (e) => log.push('PAGEERROR: ' + String(e).slice(0, 300)))
const net = []
page.on('response', async (r) => {
  if (!/plan-usage|cost\/session|model-settings/.test(r.url())) return
  let b = ''; try { b = (await r.text()).slice(0, 200) } catch {}
  net.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), status: r.status(), body: b })
})
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(12000)

const snap = await page.evaluate(() => {
  const providerNode = document.querySelector('[data-provider-id][data-model-id]')
  const pill = document.querySelector('[data-ocv2-cost]')
  const anchors = [...document.querySelectorAll('[data-composer-stat]')]
  // Where would the pill go? find the composer toolbar
  const composer = document.querySelector('[class*="composer"], [class*="Composer"], form')
  return {
    providerNode: providerNode ? {
      provider: providerNode.getAttribute('data-provider-id'),
      model: providerNode.getAttribute('data-model-id'),
    } : null,
    anchorCount: anchors.length,
    anchorStats: anchors.map((a) => a.getAttribute('data-composer-stat')),
    pillExists: Boolean(pill),
    pillText: pill?.textContent ?? null,
    hasPluginCss: Boolean(document.querySelector('style[data-plugin-css*="opencode-v2"]')),
    composerText: (composer?.textContent ?? '').trim().slice(0, 150),
    bodyModelLine: document.body.innerText.split('\n').filter((l) => /V4\.1|Flash|토큰|tok/i.test(l)).slice(0, 6),
  }
})
console.log(JSON.stringify({ snap, log: log.slice(0, 8), net: net.slice(0, 6) }, null, 1).slice(0, 6000))
await page.screenshot({ path: 'test/live/after-restart.png' })
await browser.close()
