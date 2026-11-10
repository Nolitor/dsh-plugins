import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto('https://nolitor/?token=' + encodeURIComponent(process.argv[2]), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
// How does the page know which model the composer currently uses?
const out = await page.evaluate(() => {
  const modelChip = document.querySelector('[class*="model"], [aria-label*="model"], button[class*="Model"]')
  const candidates = [...document.querySelectorAll('button, [role="button"]')]
    .filter((b) => /V4\.1 Flash|DeepSeek/i.test(b.textContent ?? ''))
    .map((b) => ({ text: (b.textContent ?? '').trim().slice(0, 50), cls: String(b.className).slice(0, 70),
      parentCls: String(b.parentElement?.className ?? '').slice(0, 60),
      attrs: [...b.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'aria-haspopup').map((a) => a.name + '=' + a.value.slice(0, 40)).slice(0, 5) }))
  return { candidates: candidates.slice(0, 6), hasModelChip: Boolean(modelChip) }
})
console.log(JSON.stringify(out, null, 1).slice(0, 2500))
await browser.close()
