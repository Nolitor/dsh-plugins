import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
const states = []
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const chip = document.querySelector('[data-ocv2-cost]')
    const activity = document.querySelector('[data-slot*="activity"], [data-slot-id*="activity"]')
    const actions = [...document.querySelectorAll('[role="button"], button')]
      .filter((b) => /V4\.1 Flash|DeepSeek/i.test(b.textContent ?? ''))
    return {
      chip: chip ? { text: chip.textContent, rect: chip.getBoundingClientRect().toJSON() } : null,
      sessionAttr: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
      activitySlot: Boolean(activity),
      composerButtons: actions.length,
      costReqSeen: window.__ocv2CostCalls ?? null,
    }
  })
  states.push({ label, ...s })
}
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
await snap('1-fresh-after-nav')
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(8000)
await snap('2-after-dismiss-8s')
await page.waitForTimeout(12000)
await snap('3-after-20s')
// now open an existing session
await page.getByText('DSH Plugins', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.getByText('오픈코드 v2 플러그인 이슈 점검', { exact: false }).first().click().catch(() => {})
await page.waitForTimeout(12000)
await snap('4-after-opening-session')
await browser.close()
console.log(JSON.stringify(states, null, 1).slice(0, 5000))
