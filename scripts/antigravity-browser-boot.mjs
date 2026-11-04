#!/usr/bin/env node
/**
 * Stage-1 S5 browser-boot check for @nolit/dsh-antigravity.
 *
 * Loads the served page in headless Chromium, verifies the plugin's client entry
 * activated, opens Settings -> Antigravity and confirms the grouped model list
 * renders. Exit 0 only when all three hold and no page error occurred.
 *
 * Usage: DSH_WEB_URL="https://host/?token=..." node scripts/antigravity-browser-boot.mjs
 * Prints one JSON line.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PLAYWRIGHT = '/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1'
const CHROME = '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'

const url = process.env.DSH_WEB_URL ?? ''
if (!url) {
  console.log(JSON.stringify({ ok: false, reason: 'DSH_WEB_URL is not set' }))
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = require(PLAYWRIGHT))
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: 'playwright-core not found: ' + error.message }))
  process.exit(1)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
})
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 200)))

let result = { ok: false }
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(9000)

  const state = await page.evaluate(() => ({
    rendered: document.body.innerText.trim().length > 0,
    entries: (window.__DSH_BOOT__?.entries ?? []).map((entry) => entry.id),
  }))
  const hasEntry = state.entries.includes('@nolit/dsh-antigravity')

  let hasTab = false
  let hasGroup = false
  try {
    const cont = page.getByRole('button', { name: /Continue|계속/ })
    if (await cont.count()) await cont.first().click({ timeout: 3000 })
    await page.waitForTimeout(500)
    const menu = page.locator('button[aria-label="Account menu"], button[aria-label="계정 메뉴"]').first()
    await menu.click({ timeout: 6000 })
    await page.waitForTimeout(500)
    await page.getByRole('menuitem', { name: /Settings|설정/ }).first().click({ timeout: 6000 })
    await page.waitForTimeout(1500)
    const text = await page.evaluate(() => document.body.innerText)
    hasTab = /Antigravity|안티그래비티/.test(text)
    const tab = page.getByText(/^(Antigravity|안티그래비티)$/).last()
    await tab.click({ timeout: 6000 })
    await page.waitForTimeout(1800)
    const panel = await page.evaluate(() => document.body.innerText)
    hasGroup = /Gemini Models|Gemini 모델/.test(panel)
  } catch {
    /* the verdict below reports which step failed */
  }

  // The live profile has a pre-existing single-slot collision between `tk` and
  // deepinfra on `conversation.input.activity`. It is not this plugin's surface
  // (the usage chip moved to the additive `input.right` list) and the owner
  // scoped other plugins out of this round, so it is reported but not fatal.
  const ignored = pageErrors.filter((line) => /single slot "conversation\.input\.activity"/.test(line))
  const relevant = pageErrors.filter((line) => !ignored.includes(line))
  const ok = state.rendered && hasEntry && hasTab && hasGroup && relevant.length === 0
  result = { ok, rendered: state.rendered, hasEntry, hasTab, hasGroup, pageErrors: relevant, ignoredErrors: ignored }
  process.exitCode = ok ? 0 : 1
} catch (error) {
  result = { ok: false, reason: String(error.message).slice(0, 200), pageErrors }
  process.exitCode = 1
} finally {
  await browser.close()
}

console.log(JSON.stringify(result))
