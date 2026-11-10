import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.getByText('DSH Plugins', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.getByText('오픈코드 v2 스타일·플랜 점검', { exact: false }).first().click().catch(() => {})
await page.waitForTimeout(9000)

const out = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-conversation-session]')]
  return {
    count: nodes.length,
    entries: nodes.map((n, i) => {
      const r = n.getBoundingClientRect()
      return {
        i,
        session: n.getAttribute('data-conversation-session'),
        tag: n.tagName, cls: String(n.className).slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        first: i === 0,
      }
    }),
    // Which one does the chat render into?
    chatRoots: [...document.querySelectorAll('[class*="chat"], [class*="Chat"]')].slice(0, 5).map((e) => ({
      cls: String(e.className).slice(0, 50), session: e.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
    })),
  }
})
console.log(JSON.stringify(out, null, 1).slice(0, 4000))
await browser.close()
