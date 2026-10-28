#!/usr/bin/env node
/**
 * Sidebar Manager live E2E runner.
 *
 * Starts an isolated DSH web server against a disposable DSH_HOME, drives the
 * real Web UI with Playwright, and restarts the isolated server between Phase A
 * and the boot finalizer. The real user server (port 3080) is never touched.
 *
 * Prerequisites:
 *   - tools/e2e/prepare-fixture.mjs has created the fixture.
 *   - the local plugin is installed in that fixture's web profile.
 *   - PLAYWRIGHT_CORE points at an installed playwright-core package.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')

const HOME = path.resolve(process.env.DSH_E2E_HOME ?? path.join(process.env.TEMP, 'dsh-e2e-home'))
const ROOT = path.resolve(process.env.DSH_E2E_ROOT ?? path.join(process.env.TEMP, 'dsh-e2e-root'))
const PORT = Number(process.env.DSH_E2E_PORT ?? 3099)
const CHROME =
  process.env.DSH_E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: ok === true, ...(detail ? { detail: String(detail).slice(0, 800) } : {}) })
  if (!ok) console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let child
let tokenUrl
let browser
let context
let page

async function portResponds() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: 'manual' })
    return response.status === 200 || response.status === 401
  } catch {
    return false
  }
}

function portOwnerPid() {
  try {
    const output = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `$c = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess }`],
      { encoding: 'utf8', windowsHide: true },
    ).trim()
    return output === '' ? undefined : Number(output)
  } catch {
    return undefined
  }
}

async function killPortOwner() {
  const pid = portOwnerPid()
  if (pid === undefined || pid === process.pid) return
  await new Promise((resolve) => {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' }).on('close', resolve)
  })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (!(await portResponds())) return
    await sleep(250)
  }
}

async function startServer() {
  if (await portResponds()) await killPortOwner()
  tokenUrl = undefined
  const env = { ...process.env, DSH_HOME: HOME }
  child = spawn('dsh', ['web', '--no-open', '--port', String(PORT)], {
    env,
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buffer = ''
  const capture = (chunk) => {
    buffer += chunk.toString()
    const match = buffer.match(new RegExp(`http://127\\.0\\.0\\.1:${PORT}/\\?token=[A-Za-z0-9_-]+`))
    if (match) tokenUrl = match[0]
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (tokenUrl !== undefined && (await portResponds())) break
    await sleep(250)
  }
  if (tokenUrl === undefined) throw new Error(`test server did not print a token:\n${buffer}`)
  await sleep(500)
  return tokenUrl
}

async function stopServer() {
  if (child === undefined) return
  const pid = child.pid
  child = undefined
  tokenUrl = undefined
  await new Promise((resolve) => {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' }).on('close', resolve)
  })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (!(await portResponds())) return
    await sleep(250)
  }
  await killPortOwner()
}

async function restartServer() {
  await stopServer()
  await startServer()
}

async function openApp() {
  await page.goto(tokenUrl, { waitUntil: 'networkidle' })
  await page.getByText('Workspaces', { exact: true }).waitFor({ timeout: 20000 })
  await sleep(700)
}

const workspaceState = () => JSON.parse(fs.readFileSync(path.join(HOME, 'storages', 'workspace.json'), 'utf8'))
const journalPath = path.join(HOME, 'sidebar-manager', 'journal', 'pending.json')
const readJournal = () => (fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : undefined)

function readHeader(sessionId) {
  const sessionsRoot = path.join(HOME, 'sessions')
  for (const project of fs.readdirSync(sessionsRoot)) {
    const file = path.join(sessionsRoot, project, sessionId, 'session.v4.jsonl.zstd')
    if (!fs.existsSync(file)) continue
    const buffer = fs.readFileSync(file)
    // The fixture logs use one header frame followed by event frames.
    const descriptorOffset = 4
    const descriptor = buffer.readUInt8(descriptorOffset)
    const singleSegment = (descriptor & 32) !== 0
    const contentSizeFlag = descriptor >>> 6
    let offset = descriptorOffset + 1
    const dictionaryBytes = (descriptor & 3) === 3 ? 4 : descriptor & 3
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const header = buffer.readUIntLE(offset, 3)
      offset += 3
      const last = (header & 1) !== 0
      const type = (header >>> 1) & 3
      const size = header >>> 3
      offset += type === 1 ? 1 : size
      if (last) break
    }
    if ((descriptor & 4) !== 0) offset += 4
    const text = zlib.zstdDecompressSync(buffer.subarray(0, offset)).toString('utf8')
    return { header: JSON.parse(text.trim()), file }
  }
  throw new Error(`session log not found: ${sessionId}`)
}

function workspaceRow(id) {
  return page.locator(`[data-row-key="workspace:${id}"]`)
}
function sessionRow(id) {
  return page.locator(`[data-row-key="session:${id}"]`)
}

async function ensureExpanded(id, expanded = true) {
  const row = workspaceRow(id)
  await row.waitFor({ timeout: 15000 })
  const current = await row.getAttribute('aria-expanded')
  if (expanded && current !== 'true') {
    await row.click()
    await sleep(500)
  } else if (!expanded && current === 'true') {
    await row.click()
    await sleep(400)
  }
}

async function openSessionMenu(id, workspaceId) {
  await ensureExpanded(workspaceId, true)
  const row = sessionRow(id)
  await row.waitFor({ timeout: 15000 })
  await row.hover()
  await sleep(250)
  await row.locator('button[aria-label^="Session actions"]').click()
  await sleep(250)
}

async function openMoveDialog(id, workspaceId) {
  await openSessionMenu(id, workspaceId)
  await page.getByRole('menuitem', { name: /Move to workspace/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

async function openForkDialog(id, workspaceId) {
  await openSessionMenu(id, workspaceId)
  await page.getByRole('menuitem', { name: /Fork to new workspace/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

async function openManager() {
  await page.locator('button[aria-label="Workspace manager"]').click()
  const panel = page.locator('section[aria-label="Workspace manager"]')
  await panel.waitFor()
  await sleep(500)
  return panel
}

function managerRow(workspaceId) {
  return page.locator('section[aria-label="Workspace manager"]').locator(`[data-workspace-id="${workspaceId}"]`)
}

async function gateReady(dialog) {
  const ack = dialog.locator('input[type=checkbox]').last()
  await ack.check()
  await sleep(100)
}

async function closeDialog() {
  await page.keyboard.press('Escape')
  await sleep(300)
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chromium not found: ${CHROME}`)
  if (!fs.existsSync(HOME)) throw new Error(`E2E DSH home not found: ${HOME}`)
  fs.mkdirSync(path.join(ROOT, 'ws-fork'), { recursive: true })

  const state = workspaceState()
  const alpha = state.tables.workspaces['ws-alpha']
  const beta = state.tables.workspaces['ws-beta']
  const [a1, a2] = alpha.sessionIds
  const [b1] = beta.sessionIds
  let betaId = 'ws-beta'
  let row

  browser = await chromium.launch({ headless: true, executablePath: CHROME })
  context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => console.log('PAGE ERROR', String(error).slice(0, 300)))

  await startServer()
  await openApp()

  // ------------------------------------------------------------------ Phase 1
  check('nav Workspace manager visible', await page.locator('button[aria-label="Workspace manager"]').isVisible())
  check('only one Workspace manager entry', (await page.locator('button[aria-label="Workspace manager"]').count()) === 1)
  await openManager()
  check('Workspace manager panel visible', await page.locator('section[aria-label="Workspace manager"]').isVisible())
  check('panel exposes inline workspace rows', (await page.locator('section[aria-label="Workspace manager"] [data-workspace-id]').count()) >= 3)
  row = managerRow('ws-alpha')
  check('folder-name field hidden by default', (await row.locator('input:not([type=checkbox])').count()) === 1)
  await row.locator('input[type=checkbox]').check()
  check('folder-name field appears when checked', (await row.locator('input:not([type=checkbox])').count()) === 2)
  await row.locator('input[type=checkbox]').uncheck()
  await ensureExpanded('ws-alpha', true)
  await ensureExpanded('ws-beta', true)
  const alphaRows = await page.locator('[data-row-key^="session:"]').evaluateAll(
    (nodes, ids) => ids.filter((id) => nodes.some((node) => node.getAttribute('data-row-key') === `session:${id}`)),
    [a1, a2],
  )
  check('E2E Alpha exposes both fixture sessions', alphaRows.length === 2)
  await sessionRow(a1).hover()
  check('hover exposes plugin trash', await sessionRow(a1).locator('button[aria-label="Permanently delete session"]').isVisible())
  await openSessionMenu(a1, 'ws-alpha')
  const menuItems = await page.getByRole('menuitem').allInnerTexts()
  check('menu has plugin purge', menuItems.some((text) => text.includes('Delete permanently')))
  check('menu has plugin move', menuItems.some((text) => text.includes('Move to workspace')))
  check('menu has plugin fork', menuItems.some((text) => text.includes('Fork to new workspace')))
  await page.keyboard.press('Escape')
  await sleep(300)

  // ------------------------------------------------------- Phase 2: guard UX
  let dialog = await openMoveDialog(a1, 'ws-alpha')
  await dialog.locator('select').selectOption({ label: 'E2E Alpha' })
  await sleep(900)
  check('move preview shows affected count', (await dialog.innerText()).includes('Affected sessions: 1'))
  check('same-workspace blocker shown', (await dialog.innerText()).includes('already belongs to the target workspace'))
  check('same-workspace submit disabled', await dialog.getByRole('button', { name: 'Schedule move' }).isDisabled())
  await closeDialog()

  await openManager()
  row = managerRow('ws-alpha')
  await row.locator('input[type=checkbox]').check()
  await row.locator('input:not([type=checkbox])').nth(1).waitFor()
  await row.getByRole('button', { name: 'Rename' }).click()
  await sleep(700)
  dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await sleep(700)
  check('default workspace folder blocker shown', (await dialog.innerText()).includes('default workspace folder cannot be renamed'))
  check('default workspace submit disabled', await dialog.getByRole('button', { name: 'Schedule rename' }).isDisabled())
  await closeDialog()
  await managerRow('ws-alpha').locator('input[type=checkbox]').uncheck()

  // title-only inline rename: Enter saves immediately, no Gate dialog
  row = managerRow('ws-delta')
  const titleInput = row.locator('input:not([type=checkbox])').first()
  await titleInput.fill('E2E Delta Title')
  await titleInput.press('Enter')
  await sleep(1000)
  check('title-only rename has no gate', (await page.getByRole('dialog').count()) === 0)
  check('title-only rename updated inline value', (await titleInput.inputValue()) === 'E2E Delta Title')
  await titleInput.fill('Temporary Title')
  await titleInput.press('Escape')
  check('Escape restores inline draft', (await titleInput.inputValue()) === 'E2E Delta Title')
  await titleInput.fill('E2E Delta')
  await titleInput.press('Enter')
  await sleep(800)

  dialog = await openForkDialog(a1, 'ws-alpha')
  await dialog.locator('input').nth(0).fill('External Fork')
  await dialog.locator('input').nth(1).fill(path.join(process.env.USERPROFILE, 'OutsideE2E'))
  await sleep(1000)
  check('external fork blocker shown', (await dialog.innerText()).includes('outside projectsRoot'))
  check('external fork submit disabled', await dialog.getByRole('button', { name: 'Schedule fork' }).isDisabled())
  await closeDialog()

  // non-archived purge guard
  await sessionRow(a1).hover()
  await sessionRow(a1).locator('button[aria-label="Permanently delete session"]').click()
  dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await sleep(500)
  check('non-archived purge blocked', (await dialog.innerText()).includes('Archive the session first'))
  check('non-archived purge submit disabled', await dialog.getByRole('button', { name: 'Delete permanently' }).isDisabled())
  await closeDialog()

  // ------------------------------------------------------ Phase 3: move + boot
  dialog = await openMoveDialog(a1, 'ws-alpha')
  await dialog.locator('select').selectOption({ label: 'E2E Beta' })
  await sleep(1000)
  check('move preview ok', (await dialog.innerText()).includes('Affected sessions: 1'))
  check('move submit disabled before ack', await dialog.getByRole('button', { name: 'Schedule move' }).isDisabled())
  await gateReady(dialog)
  check('move submit enabled after ack', !(await dialog.getByRole('button', { name: 'Schedule move' }).isDisabled()))
  await dialog.getByRole('button', { name: 'Schedule move' }).click()
  await sleep(1000)
  check('move journal files-ready', readJournal()?.state === 'files-ready')
  await restartServer()
  await openApp()
  await ensureExpanded('ws-beta', false)
  await ensureExpanded('ws-alpha', true)
  check('moved session hidden under alpha', !(await sessionRow(a1).isVisible()))
  await ensureExpanded('ws-alpha', false)
  await ensureExpanded('ws-beta', true)
  check('moved session visible under beta', await sessionRow(a1).isVisible())
  check('moved session header cwd beta', readHeader(a1).header.cwd === beta.path)
  const afterMove = workspaceState()
  check('registry moved session to beta', afterMove.tables.workspaces['ws-beta'].sessionIds.includes(a1))
  check('registry removed session from alpha', !afterMove.tables.workspaces['ws-alpha'].sessionIds.includes(a1))
  check('move journal committed', readJournal()?.state === 'committed')

  // ----------------------------------------------- Phase 4: archive/restore
  const panel = await openManager()
  await managerRow('ws-delta').getByRole('button', { name: 'Archive' }).click()
  await sleep(1200)
  check('archived workspace group removed', (await workspaceRow('ws-delta').count()) === 0)
  check('archived section visible', (await panel.innerText()).includes('Archived workspaces'))
  await panel.getByRole('button', { name: 'Restore' }).first().click()
  await sleep(1200)
  check('restored workspace group visible', (await page.getByText('E2E Delta', { exact: true }).count()) >= 1)

  // -------------------------------------------------------- Phase 5: rename
  await openManager()
  row = managerRow('ws-beta')
  await row.locator('input[type=checkbox]').check()
  const folderInput = row.locator('input:not([type=checkbox])').nth(1)
  await folderInput.waitFor({ state: 'visible', timeout: 10000 })
  await folderInput.fill('ws-beta-renamed')
  await sleep(500)
  check('inline folder path preview shown', (await row.innerText()).includes('ws-beta-renamed'))
  await row.getByRole('button', { name: 'Rename' }).click()
  await sleep(700)
  dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await sleep(900)
  check('folder rename gate requires ack', await dialog.getByRole('button', { name: 'Schedule rename' }).isDisabled())
  await gateReady(dialog)
  await dialog.getByRole('button', { name: 'Schedule rename' }).click()
  await sleep(1000)
  check('rename journal files-ready', readJournal()?.state === 'files-ready')
  await restartServer()
  await openApp()
  const afterRename = workspaceState()
  const renamedEntry = Object.entries(afterRename.tables.workspaces).find(([, record]) => record.title === 'E2E Beta')
  check('renamed workspace record exists', renamedEntry !== undefined)
  const [renamedId, renamedRecord] = renamedEntry ?? []
  betaId = renamedId ?? betaId
  check('renamed path registered', renamedRecord?.path.endsWith('ws-beta-renamed') === true)
  check('renamed folder exists', renamedRecord !== undefined && fs.existsSync(renamedRecord.path))
  check('old folder removed', !fs.existsSync(beta.path))
  check('renamed session cwd updated', renamedRecord !== undefined && readHeader(a1).header.cwd === renamedRecord.path)
  check('rename journal committed', readJournal()?.state === 'committed')

  // ---------------------------------------------------------- Phase 6: fork
  dialog = await openForkDialog(a2, 'ws-alpha')
  await dialog.locator('input').nth(0).fill('E2E Fork')
  await dialog.locator('input').nth(1).fill(path.join(ROOT, 'ws-fork'))
  await sleep(1200)
  check('fork preview ok', (await dialog.innerText()).includes('Affected sessions: 1'))
  await gateReady(dialog)
  await dialog.getByRole('button', { name: 'Schedule fork' }).click()
  await sleep(1200)
  const forkJournal = readJournal()
  check('fork journal files-ready', forkJournal?.state === 'files-ready', JSON.stringify(forkJournal))
  await restartServer()
  await openApp()
  const afterFork = workspaceState()
  const forkEntry = Object.entries(afterFork.tables.workspaces).find(([, record]) => record.path.endsWith('ws-fork'))
  check('fork workspace registered', forkEntry !== undefined)
  if (forkEntry !== undefined) {
    const [forkId, record] = forkEntry
    check('fork workspace has one session', record.sessionIds.length === 1)
    check('fork session log cwd', readHeader(record.sessionIds[0]).header.cwd === record.path)
    await ensureExpanded(forkId, true)
    check('fork workspace visible with session', await sessionRow(record.sessionIds[0]).isVisible())
  }
  check('fork journal committed', readJournal()?.state === 'committed')

  // --------------------------------------------------------- Phase 7: purge
  await ensureExpanded(betaId, true)
  const purgeId = b1
  await sessionRow(purgeId).hover()
  await sessionRow(purgeId).locator('button[aria-label="Archive session"]').click()
  await sleep(1000)
  await page.locator('button[aria-label="View options"]').click()
  await sleep(300)
  await page.getByRole('menuitem', { name: /All conversations \(show archived\)/ }).click()
  await sleep(800)
  await ensureExpanded(betaId, true)
  await sessionRow(purgeId).hover()
  await sessionRow(purgeId).locator('button[aria-label="Permanently delete session"]').click()
  dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await sleep(600)
  await dialog.locator('input[type=checkbox]').last().check()
  await dialog.getByRole('button', { name: 'Delete permanently' }).click()
  await sleep(1500)
  const afterPurge = workspaceState()
  check('purged session removed from registry', !JSON.stringify(afterPurge).includes(purgeId))
  check('purged log removed', (() => {
    try {
      readHeader(purgeId)
      return false
    } catch {
      return true
    }
  })())
  const backupRoot = path.join(HOME, 'backup')
  check('purge backup exists', fs.existsSync(backupRoot) && fs.readdirSync(backupRoot).length > 0)

  const failed = checks.filter((entry) => !entry.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, checkCount: checks.length, failed: failed.length, checks }, null, 2))
  if (failed.length > 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.error('E2E ERROR', error)
  process.exitCode = 1
} finally {
  if (browser !== undefined) await browser.close().catch(() => {})
  await stopServer().catch(() => {})
}
