import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const log = []
page.on('pageerror', (e) => log.push('PAGEERROR: ' + String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text().slice(0, 250)) })
const net = []
page.on('response', async (r) => { if (/plan-usage/.test(r.url())) net.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 150) }) })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(9000)

const before = await page.evaluate(() => {
  const chip = document.querySelector('[data-ocv2-cost]')
  return { present: Boolean(chip), text: chip?.textContent, rect: chip ? chip.getBoundingClientRect().toJSON() : null, pointer: chip ? getComputedStyle(chip).pointerEvents : null }
})
// click via real mouse at the chip centre
if (before.rect) {
  await page.mouse.click(before.rect.x + before.rect.width / 2, before.rect.y + before.rect.height / 2)
}
await page.waitForTimeout(3500)
const after = await page.evaluate(() => {
  const p = document.querySelector('[data-ocv2-plan]')
  return {
    panel: p ? { text: p.innerText.replace(/\n/g, ' | ').slice(0, 200), w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height) } : null,
    panelCount: document.querySelectorAll('[data-ocv2-plan]').length,
  }
})
await page.screenshot({ path: 'test/live/panel-live.png' })
await browser.close()
console.log(JSON.stringify({ before, after, net, errors: log.slice(0, 6) }, null, 1).slice(0, 4000))
