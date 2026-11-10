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

// Sidebar: pick the workspace, then a session that has real turns.
await page.getByText('DSH Plugins', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.getByText('오픈코드 v2 플러그인 이슈 점검', { exact: false }).first().click().catch(() => {})

// The status pills only exist once the session reports token usage; poll for them.
let anchors = 0
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(2000)
  anchors = await page.evaluate(() => document.querySelectorAll('[data-composer-stat]').length)
  if (anchors > 0) break
}
const measured = await page.evaluate(() => {
  const list = [...document.querySelectorAll('[data-composer-stat]')]
  const own = document.querySelector('[data-ocv2-cost]')
  return {
    sessionId: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
    anchorCount: list.length,
    anchors: list.map((el) => ({ stat: el.getAttribute('data-composer-stat'), text: (el.textContent ?? '').trim().slice(0, 70) })),
    pill: own ? { text: (own.textContent ?? '').trim(), title: own.getAttribute('title'), cls: String(own.className) } : null,
    rowText: own?.parentElement ? (own.parentElement.textContent ?? '').trim().slice(0, 140) : null,
  }
})
await page.screenshot({ path: 'test/live/cost-pill.png' })
await browser.close()
console.log(JSON.stringify(measured, null, 1))
