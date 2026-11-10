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
await page.waitForTimeout(9000)

const out = await page.evaluate(() => {
  const chip = document.querySelector('[data-ocv2-cost]')
  const model = [...document.querySelectorAll('button')].find((b) => /V4\.1 Flash|DeepSeek V4/i.test(b.textContent ?? ''))
  if (!chip || !model) return { chip: Boolean(chip), model: Boolean(model) }

  const chain = (el, n = 5) => {
    const out = []
    let cur = el
    for (let i = 0; i < n && cur; i += 1) {
      const cs = getComputedStyle(cur)
      const r = cur.getBoundingClientRect()
      out.push({
        tag: cur.tagName, cls: String(cur.className).slice(0, 50),
        display: cs.display, flexGrow: cs.flexGrow, justify: cs.justifyContent,
        gap: cs.gap, w: Math.round(r.width), x: Math.round(r.x),
        kids: cur.childElementCount,
      })
      cur = cur.parentElement
    }
    return out
  }
  // nearest common ancestor
  const ancestors = (el) => { const s = new Set(); let c = el; while (c) { s.add(c); c = c.parentElement } return s }
  const ca = ancestors(model)
  let common = chip.parentElement
  while (common && !ca.has(common)) common = common.parentElement
  const cc = common ? getComputedStyle(common) : null
  return {
    chipChain: chain(chip),
    modelChain: chain(model),
    common: common ? {
      tag: common.tagName, cls: String(common.className).slice(0, 50),
      display: cc.display, justify: cc.justifyContent, gap: cc.gap,
      w: Math.round(common.getBoundingClientRect().width),
      childOrder: [...common.children].map((c) => String(c.className).slice(0, 34)),
    } : null,
  }
})
console.log(JSON.stringify(out, null, 1).slice(0, 5000))
await browser.close()
