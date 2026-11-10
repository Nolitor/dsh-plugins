import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const log = []
page.on('pageerror', (e) => log.push('PAGEERROR: ' + String(e).slice(0, 240)))
page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text().slice(0, 200)) })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
// IMPORTANT: no session opened, no turn sent — this is the "before any conversation" state.
await page.waitForTimeout(10000)

const before = await page.evaluate(() => {
  const chip = document.querySelector('[data-ocv2-cost]')
  const m = chip ? getComputedStyle(chip) : null
  return {
    chipPresent: Boolean(chip),
    chipText: chip?.textContent ?? null,
    chipTag: chip?.tagName ?? null,
    chipCls: chip ? String(chip.className) : null,
    fs: m?.fontSize ?? null, h: chip ? Math.round(chip.getBoundingClientRect().height) : null,
    parentCls: chip ? String(chip.parentElement?.className).slice(0, 60) : null,
  }
})

// Click it and see whether the plan panel opens.
let panel = null
if (before.chipPresent) {
  await page.locator('[data-ocv2-cost]').click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(3000)
  panel = await page.evaluate(() => {
    const p = document.querySelector('[data-ocv2-plan]')
    return p ? { present: true, text: p.innerText.replace(/\n/g, ' | ').slice(0, 200), w: Math.round(p.getBoundingClientRect().width) } : { present: false }
  })
}
await page.screenshot({ path: 'test/live/slot-chip.png' })
await browser.close()
console.log(JSON.stringify({ before, panel, errors: log.slice(0, 5) }, null, 1))
