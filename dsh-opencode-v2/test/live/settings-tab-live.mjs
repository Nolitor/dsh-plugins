/**
 * Live browser measurement of the OpenCode V2 settings tab.
 *
 * Reads computed styles off the running DSH Web GUI, so a style change is judged
 * by what the browser actually paints instead of by what the stylesheet says.
 * Read-only: it opens Settings, visits the tab, measures, screenshots, closes.
 *
 * Usage (the token is the one `dsh web` printed; it is not stored here):
 *
 *   DSH_WEB_URL=https://127.0.0.1:3080/ DSH_WEB_TOKEN=<token> \
 *     node test/live/settings-tab-live.mjs [--out dir]
 *
 * The assertions are the same contract as test/client-rows.test.mjs, checked
 * here against a real layout: 14px/22px root, two text lines per row, both lines
 * ellipsised, and no row whose name and route share one text node.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const PLAYWRIGHT = process.env.DSH_PLAYWRIGHT ?? '/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1'
const CHROMIUM = process.env.DSH_CHROMIUM ?? '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'

const url = process.env.DSH_WEB_URL
const token = process.env.DSH_WEB_TOKEN
if (!url || !token) {
  console.error('DSH_WEB_URL and DSH_WEB_TOKEN are required (both are printed by `dsh web`)')
  process.exit(2)
}
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : 'artifacts/settings-tab'
mkdirSync(outDir, { recursive: true })

const { chromium } = require(PLAYWRIGHT)
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(url + '?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(7000)
const dismiss = page.getByRole('button', { name: '나중에' })
if (await dismiss.count()) await dismiss.first().click().catch(() => {})
await page.keyboard.press('Escape').catch(() => {})
await page.getByRole('button', { name: '계정 메뉴' }).click({ timeout: 8000 })
await page.getByText('설정', { exact: true }).first().click({ timeout: 8000 })
await page.getByText('오픈코드 V2', { exact: true }).first().click({ timeout: 8000 })
await page.waitForSelector('.ocv2Section', { timeout: 8000 })

const measured = await page.evaluate(() => {
  const css = (el) => {
    const style = getComputedStyle(el)
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflow: style.overflow,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      color: style.color,
    }
  }
  const section = document.querySelector('.ocv2Section')
  const rows = [...section.querySelectorAll('.ocv2Model')].slice(0, 12).map((row) => {
    const name = row.querySelector('.ocv2ModelName')
    const route = row.querySelector('.ocv2Route')
    const nameBox = name?.getBoundingClientRect()
    const routeBox = route?.getBoundingClientRect()
    return {
      rowText: row.innerText,
      nameText: name?.textContent ?? '',
      routeText: route?.textContent ?? '',
      name: name ? css(name) : null,
      route: route ? css(route) : null,
      // A two-line row means the route starts below the name, not beside it.
      stacked: Boolean(nameBox && routeBox && routeBox.top >= nameBox.bottom - 1),
      nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null,
      routeClipped: route ? route.scrollWidth > route.clientWidth + 1 : null,
      nameTitle: name?.getAttribute('title') ?? null,
      routeTitle: route?.getAttribute('title') ?? null,
    }
  })
  return {
    section: css(section),
    heading: css(section.querySelector('.ocv2Heading')),
    card: (() => {
      const card = section.querySelector('.ocv2Card')
      return card ? { ...css(card), border: getComputedStyle(card).border } : null
    })(),
    segmentOn: (() => {
      const on = section.querySelector('.ocv2Segment[aria-pressed="true"]')
      if (!on) return null
      const style = getComputedStyle(on)
      return { backgroundColor: style.backgroundColor, color: style.color }
    })(),
    rowCount: section.querySelectorAll('.ocv2Model').length,
    rows,
  }
})

await page.screenshot({ path: join(outDir, 'settings-tab.png'), fullPage: false })
writeFileSync(join(outDir, 'settings-tab.json'), JSON.stringify({ measured, errors }, null, 2))
await browser.close()

const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }
expect(measured.section.fontSize === '14px', 'section root must compute 14px, got ' + measured.section.fontSize)
expect(measured.section.lineHeight === '22px', 'section root must compute 22px, got ' + measured.section.lineHeight)
expect(measured.rows.length > 0, 'the tab must render model rows')
for (const row of measured.rows) {
  expect(row.stacked, 'name and route must be two lines: ' + row.nameText)
  expect(row.name.fontSize === '14px', 'name must be 14px: ' + row.nameText)
  expect(row.route.fontSize === '12px', 'route must be 12px: ' + row.routeText)
  expect(row.name.whiteSpace === 'nowrap' && row.name.textOverflow === 'ellipsis', 'name must ellipsise')
  expect(row.route.whiteSpace === 'nowrap' && row.route.textOverflow === 'ellipsis', 'route must ellipsise')
  expect(row.nameTitle === row.nameText, 'name tooltip must carry the full value')
  expect(row.routeTitle === row.routeText, 'route tooltip must carry the full value')
}
expect(measured.segmentOn?.backgroundColor !== 'rgba(0, 0, 0, 0)', 'the selected plan must paint a fill')
expect(errors.length === 0, 'no page errors: ' + errors.join('; '))

console.log(JSON.stringify({ out: outDir, rowCount: measured.rowCount, failures, sample: measured.rows.slice(0, 3) }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
