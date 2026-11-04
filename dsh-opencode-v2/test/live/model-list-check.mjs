import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
const [url, token] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)))
await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(9000)
const d = page.getByRole('button', { name: '나중에' })
if (await d.count()) await d.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(10000)

const state = await page.evaluate(() => {
  const modelTrigger = document.querySelector('._7KE1Ra_trigger')
  const triggerLabel = document.querySelector('._7KE1Ra_triggerLabel')
  const providerNode = document.querySelector('[data-provider-id]')
  const chip = document.querySelector('[data-ocv2-cost]')
  // Is the model selector still there and does it still show the catalog name?
  return {
    modelTriggerExists: Boolean(modelTrigger),
    modelTriggerText: modelTrigger?.textContent?.trim().slice(0, 80) ?? null,
    triggerLabelHTML: triggerLabel?.innerHTML?.slice(0, 400) ?? null,
    providerNodeExists: Boolean(providerNode),
    providerAttrs: providerNode ? { p: providerNode.getAttribute('data-provider-id'), m: providerNode.getAttribute('data-model-id') } : null,
    chipInsideTrigger: Boolean(chip && modelTrigger && modelTrigger.contains(chip)),
    chipText: chip?.textContent ?? null,
    chipCls: chip ? String(chip.className) : null,
    bodyHasModelName: /DeepSeek V4\.1 Flash/.test(document.body.innerText),
  }
})
console.log(JSON.stringify(state, null, 1).slice(0, 3000))
await page.screenshot({ path: 'test/live/model-list-check.png' })
await browser.close()
