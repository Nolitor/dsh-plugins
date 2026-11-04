#!/usr/bin/env node
/**
 * S5 browser-boot check for the stage-1 gate.
 *
 * Loads the served page in headless chromium, waits for the shell to settle, and reports
 * what actually happened: page errors, the client plugin entries, and whether the OpenCode
 * V2 route is offered in the model picker. Exit 0 only when the shell renders and this
 * plugin's client half is among the activated entries.
 *
 * Why a real browser: policy §"Upgrade gate" — a route probe, a 200 on the client bundle
 * and `node --check` all pass while a client module is unloadable (measured 2026-10-30).
 *
 * Usage: DSH_WEB_URL="https://host/?token=…" node scripts/opencode-v2-browser-boot.mjs
 * Prints one JSON line: { ok, entries, pageErrors, consoleErrors, opencodeModels }
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
const consoleErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 200)))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200))
})

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(9000)
  const state = await page.evaluate(() => {
    const boot = window.__DSH_BOOT__ ?? {}
    const entries = (boot.entries ?? []).map((entry) => entry.id)
    const body = document.body.innerText
    return {
      rendered: body.trim().length > 0,
      entries,
      hasOwnEntry: entries.includes('@nolit/dsh-opencode-v2'),
      chatShell: /세션|Session|새 세션/i.test(body),
    }
  })
  // A picker probe is best-effort: the composer may not carry a chip until a session opens.
  const opencodeModels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-provider-id]')].map((n) => n.getAttribute('data-provider-id')))
  const ok = state.rendered && state.hasOwnEntry && pageErrors.length === 0
  console.log(JSON.stringify({
    ok,
    rendered: state.rendered,
    hasOwnEntry: state.hasOwnEntry,
    entryCount: state.entries.length,
    opencodeModels,
    pageErrors,
    consoleErrors: consoleErrors.filter((line) => !/deepseek-account|404/.test(line)).slice(0, 5),
  }))
  process.exitCode = ok ? 0 : 1
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: String(error.message).slice(0, 200), pageErrors }))
  process.exitCode = 1
} finally {
  await browser.close()
}
