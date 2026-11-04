import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto('https://nolitor/?token=' + encodeURIComponent(process.argv[2]), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const out = await page.evaluate(() => {
  const chip = document.querySelector('._7KE1Ra_trigger')
  if (!chip) return { found: false }
  const html = chip.outerHTML
  // Does anything expose the provider/model route, not just the display name?
  const allAttrs = []
  for (const el of [chip, ...chip.querySelectorAll('*')]) {
    for (const a of el.attributes ?? []) allAttrs.push(el.tagName + ' ' + a.name + '=' + a.value.slice(0, 60))
  }
  return {
    text: chip.textContent.trim(),
    html: html.slice(0, 600),
    attrs: allAttrs.slice(0, 20),
    hasOpencodeToken: /opencode/i.test(html),
  }
})
console.log(JSON.stringify(out, null, 1).slice(0, 3500))
await browser.close()
