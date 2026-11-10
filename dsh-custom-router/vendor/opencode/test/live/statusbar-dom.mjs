import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })

// Inject the boot token the way the shell does, so we land on a real session.
const res = await fetch('https://nolitor/?token=' + process.argv[2], { headers: { 'x-forwarded-proto': 'https' } }).catch(() => null)
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
await page.goto('https://nolitor/?token=' + process.argv[2], { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const out = await page.evaluate(() => {
  const text = document.body.innerText
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  // Where does the status bar live? Find the element holding the cache-hit text.
  const all = [...document.querySelectorAll('*')]
  const cacheNodes = all.filter((el) => el.childElementCount === 0 && /캐시|cache/i.test(el.textContent ?? ''))
  const describe = (el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName, cls: String(el.className).slice(0, 70),
      text: (el.textContent ?? '').trim().slice(0, 80),
      parent: el.parentElement ? el.parentElement.tagName + '.' + String(el.parentElement.className).slice(0, 50) : null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      fs: cs.fontSize, color: cs.color, display: cs.display,
    }
  }
  return {
    cacheNodes: cacheNodes.slice(0, 8).map(describe),
    tailLines: lines.slice(-25),
    // candidate containers near the bottom of the viewport
    bottomBars: all.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height > 10 && r.height < 60 && r.width > 400 && r.y > window.innerHeight - 90
    }).slice(0, 10).map(describe),
  }
})
console.log(JSON.stringify(out, null, 1).slice(0, 6000))
await browser.close()
