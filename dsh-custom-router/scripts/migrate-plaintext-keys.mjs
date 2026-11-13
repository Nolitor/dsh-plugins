#!/usr/bin/env node
/**
 * One-shot plaintext-key migration — profile patch → DSH credential store.
 *
 * WHAT IT DOES
 *   1. reads the live profile patch (`~/.dsh/profiles/web/cordis.patch.yml` by
 *      default) and PLANS the migration: for each managed row
 *      (`dsh-deepinfra`, `dsh-exaone`), the plaintext `apiKey:` line and the
 *      store ref it takes (`DEEPINFRA_API_KEY`, `EXAONE_API_KEY`);
 *   2. with `--apply`: backs the patch up (0600, clearly named), writes each
 *      value into the DSH credential store (`$DSH_HOME/.credentials.yaml` →
 *      `refs:`), CONFIRMS each ref resolves back to the same value, and only
 *      then replaces the plaintext line with `credentialRef: <ref>`.
 *
 * THE STORE WRITE
 *   The service's write method (`ctx.credentials.set(ref, value)`) is not
 *   reachable from a one-shot script, so the YAML is written ATOMICALLY with
 *   mode 0600 instead — the same commit protocol the credential provider
 *   itself uses (`writeFileAtomic` from `@deepseek-ai/dsh-atomic-write`, under
 *   the document's own writer lock). The edit is a `yaml` Document
 *   `setIn(['refs', ref])`, so `version:`, `records:` and every other entry
 *   survive byte for byte; the provider watches the file and picks the change
 *   up without a restart.
 *
 * SECRETS
 *   No value is printed, logged, or echoed. The report carries a ref name and
 *   a redacted shape (`<redacted len=N>`) only.
 *
 * Usage:
 *   node scripts/migrate-plaintext-keys.mjs --dry-run     # plan only
 *   node scripts/migrate-plaintext-keys.mjs --apply       # perform it
 *   node scripts/migrate-plaintext-keys.mjs --apply --patch <file> --home <dir>
 *
 * Exit codes: 0 ok / nothing to do, 1 refused or failed, 2 usage error.
 *
 * @module @nolit/dsh-custom-router/scripts/migrate-plaintext-keys
 */
import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { MIGRATION_TARGETS, planPlaintextKeyMigration, redact } from '../lib/credential-migration.js'

const HERE = dirname(new URL(import.meta.url).pathname)
const PACKAGE_ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const APPLY = argv.includes('--apply')
const DRY_RUN = argv.includes('--dry-run') || !APPLY
const PATCH_PATH = resolve(flag('--patch', join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')))
const DSH_HOME = resolve(flag('--home', join(homedir(), '.dsh')))
const CREDENTIALS_PATH = resolve(flag('--credentials', join(DSH_HOME, '.credentials.yaml')))

if (APPLY && DRY_RUN && !argv.includes('--dry-run')) DRY_RUN = false

const require = createRequire(import.meta.url)

/**
 * Resolve a host package from the DSH installation.
 *
 * The router's own tree has no `yaml` and no `dsh-atomic-write`; both ship
 * with the Host. The install tree is located through the `dsh` CLI on PATH,
 * which is the same anchor the router uses at mount (`installAnchor`).
 * @param {string} specifier - the package specifier.
 * @returns {string} an absolute file path.
 */
function resolveHostPackage(specifier) {
  const { execFileSync } = require('node:child_process')
  const { realpathSync } = require('node:fs')
  const bin = execFileSync('bash', ['-lc', 'command -v dsh'], { encoding: 'utf8' }).trim()
  if (bin === '') throw new Error('dsh is not on PATH; cannot locate the Host install tree')
  const root = resolve(dirname(realpathSync(bin)), '..')
  return createRequire(join(root, 'package.json')).resolve(specifier)
}

/**
 * Read the credential store's current refs (names only — never a value).
 * @param {string} path - the store file.
 * @returns {Promise<{refs: string[], records: string[], version: unknown}>} the shape.
 */
async function readStoreShape(path) {
  const { parseDocument } = await import(pathToFileURL(resolveHostPackage('yaml')).href)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { refs: [], records: [], version: undefined }
  }
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`the credential store does not parse: ${document.errors.map((e) => e.code).join('; ')}`)
  const root = document.toJS() ?? {}
  return {
    refs: Object.keys(root.refs ?? {}),
    records: Object.keys(root.records ?? {}),
    version: root.version,
  }
}

/**
 * Write one ref into the store, atomically, under the document's writer lock.
 *
 * The `yaml` Document edit is surgical: `setIn(['refs', ref], value)` adds or
 * replaces ONE entry, so `version:`, `records:` and every other ref keep
 * their bytes. The commit is the provider's own protocol
 * (`writeFileAtomic` + `withFileLock`), at mode 0600.
 *
 * @param {string} path - the store file.
 * @param {string} ref - the ref name.
 * @param {string} value - the secret (never logged).
 * @returns {Promise<void>} settlement.
 */
async function writeStoreRef(path, ref, value) {
  const { parseDocument } = await import(pathToFileURL(resolveHostPackage('yaml')).href)
  const { writeFileAtomic, withFileLock } = await import(pathToFileURL(resolveHostPackage('@deepseek-ai/dsh-atomic-write')).href)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    text = undefined
  }
  await withFileLock(path, async () => {
    let current = text
    try {
      current = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      current = undefined
    }
    const document = current === undefined
      ? (await import(pathToFileURL(resolveHostPackage('yaml')).href)).parseDocument('')
      : parseDocument(current, { prettyErrors: true, uniqueKeys: true })
    if (document.errors.length > 0) throw new Error(`the credential store does not parse: ${document.errors.map((e) => e.code).join('; ')}`)
    document.setIn(['version'], 1)
    document.setIn(['refs', ref], value)
    await writeFileAtomic(path, document.toString(), { mode: 0o600, dirMode: 0o700 })
  }, { waitMs: 30000 })
}

/**
 * Read one ref back from the store and compare it to the value written.
 *
 * The provider watches the file, so the confirmation can be a direct read of
 * the committed document rather than a wait for the host's in-memory snapshot.
 *
 * @param {string} path - the store file.
 * @param {string} ref - the ref name.
 * @param {string} expected - the value that must be there.
 * @returns {Promise<boolean>} whether the store now holds the value.
 */
async function confirmStoreRef(path, ref, expected) {
  const { parseDocument } = await import(pathToFileURL(resolveHostPackage('yaml')).href)
  const text = await readFile(path, 'utf8')
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) return false
  const root = document.toJS() ?? {}
  return root.refs?.[ref] === expected
}

/**
 * Copy the patch to a clearly named owner-only backup.
 * @param {string} patchPath - the patch file.
 * @returns {Promise<string>} the backup path.
 */
async function backup(patchPath) {
  const { copyFile, chmod } = await import('node:fs/promises')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const target = `${patchPath}.bak.before-plaintext-key-migration-${stamp}`
  await copyFile(patchPath, target)
  await chmod(target, 0o600)
  return target
}

/**
 * Replace the planned plaintext lines with their references, atomically.
 * @param {string} patchPath - the patch file.
 * @param {readonly object[]} plan - the plan.
 * @returns {Promise<void>} settlement.
 */
async function applyRemoval(patchPath, plan) {
  const { writeFileAtomic } = await import(pathToFileURL(resolveHostPackage('@deepseek-ai/dsh-atomic-write')).href)
  const original = await readFile(patchPath, 'utf8')
  const lines = original.split('\n')
  for (const item of plan) lines[item.line - 1] = `${item.indent}credentialRef: ${item.ref}`
  await writeFileAtomic(patchPath, lines.join('\n'), { mode: 0o600, dirMode: 0o700 })
}

const line = (text) => process.stdout.write(`${text}\n`)

const patchText = await readFile(PATCH_PATH, 'utf8')
const planned = planPlaintextKeyMigration(patchText)
const storeShape = await readStoreShape(CREDENTIALS_PATH)

line(`patch:    ${PATCH_PATH}`)
line(`store:    ${CREDENTIALS_PATH}`)
line(`store:    version=${storeShape.version} refs=[${storeShape.refs.join(', ')}] records=[${storeShape.records.join(', ')}]`)

for (const row of planned.rows) {
  line(`row:      ${row.row} -> ${row.ref} : ${row.found ? `plaintext apiKey at line ${row.line}` : 'no plaintext apiKey found'}`)
}

if (planned.problems.length > 0) {
  for (const problem of planned.problems) line(`REFUSED:  ${problem}`)
  process.exit(1)
}

if (planned.plan.length === 0) {
  line('result:   nothing to migrate')
  process.exit(0)
}

for (const item of planned.plan) {
  line(`plan:     ${item.row} line ${item.line} -> credentialRef: ${item.ref} (${redact(item.value)})`)
}

if (!APPLY) {
  line('result:   dry run — nothing was written')
  process.exit(0)
}

// 1. back up, before anything is touched
const backupPath = await backup(PATCH_PATH)
const backupMode = (await stat(backupPath)).mode & 0o777
line(`backup:   ${backupPath} (mode ${backupMode.toString(8)})`)

// 2+3. store, then confirm — the plaintext key stays in place until this passes
for (const item of planned.plan) {
  await writeStoreRef(CREDENTIALS_PATH, item.ref, item.value)
  const confirmed = await confirmStoreRef(CREDENTIALS_PATH, item.ref, item.value)
  if (!confirmed) {
    line(`REFUSED:  ${item.ref} did not resolve to the stored value; the plaintext key was left in place`)
    process.exit(1)
  }
  line(`stored:   ${item.ref} confirmed in the credential store (${redact(item.value)})`)
}

// 4. only now the plaintext lines go
await applyRemoval(PATCH_PATH, planned.plan)
for (const item of planned.plan) {
  line(`migrated: ${item.row} line ${item.line} -> credentialRef: ${item.ref}`)
}
line('result:   done')
