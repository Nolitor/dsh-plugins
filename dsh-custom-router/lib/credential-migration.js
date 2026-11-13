/**
 * Plaintext API-key migration — profile patch → DSH credential store.
 *
 * WHY
 *   A provider key that lives as a plaintext `apiKey:` line in a profile patch
 *   is a secret in a file the whole toolchain reads, diffs and prints. The DSH
 *   credential store (`$DSH_HOME/.credentials.yaml` → `refs:`) is the managed
 *   home for such a value: the profile keeps only the REFERENCE
 *   (`credentialRef: DEEPINFRA_API_KEY`) and the adapter resolves it through
 *   `ctx.credentials` (see `vendor/deepinfra/lib/index.js` and
 *   `vendor/exaone/lib/index.js`).
 *
 * WHAT THIS MODULE DOES (and does not) DO
 *   It is a LINE-ORIENTED editor, never a YAML load/dump: the profile patch
 *   carries comments and an order a rewrite would silently destroy. Only the
 *   `apiKey:` line of the two managed rows is touched; every other byte of the
 *   file is preserved, and the result is proven by a diff in the report.
 *
 * THE ORDER IS THE SAFETY PROPERTY
 *   1. back the file up (0600, clearly named),
 *   2. write the value into the store,
 *   3. CONFIRM the store now resolves that ref to the same value,
 *   4. only then replace the plaintext line with the reference.
 *
 *   A plaintext key is never deleted before its store entry is confirmed
 *   written: there is no env fallback on the live service, so a lost value is a
 *   lost route. Steps 2-3 are therefore a hard gate, and a failure anywhere
 *   before step 4 leaves the file untouched.
 *
 * SECRETS
 *   No value is ever logged, printed, returned in a report field, or written
 *   anywhere except the credential store. The only shape that leaves this
 *   module is `<redacted len=N>`.
 *
 * @module @nolit/dsh-custom-router/credential-migration
 */
import { chmod, copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Write a file atomically with owner-only permissions.
 *
 * The default writer is a plain write with the file's own mode; the one-shot
 * script injects the host's `writeFileAtomic` so the store write uses the
 * provider's own commit protocol.
 *
 * @param {string} path - the target path.
 * @param {string} text - the new content.
 * @returns {Promise<void>} settlement.
 */
export async function writeOwnerOnly(path, text) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, text, { mode: 0o600 })
  await chmod(path, 0o600)
}

/**
 * Build an atomic, owner-only writer from the Host's own atomic-write package.
 *
 * The profile patch is a file the whole toolchain reads: a truncated write
 * would break the profile. The Host writes such files with
 * `writeFileAtomic` (a random-suffix sibling plus a rename), so the migration
 * uses the same commit protocol.
 *
 * @param {string} installAnchor - the DSH install `package.json`.
 * @returns {Promise<(path: string, text: string) => Promise<void>>} the writer.
 */
export async function atomicOwnerOnlyWriter(installAnchor) {
  const { createRequire } = await import('node:module')
  const { dirname, join } = await import('node:path')
  const require = createRequire(join(installAnchor, 'package.json'))
  const { writeFileAtomic } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href)
  return async (path, text) => {
    await writeFileAtomic(path, text, { mode: 0o600, dirMode: 0o700 })
  }
}

/**
 * The rows whose plaintext `apiKey` migrates, and the store ref each one takes.
 *
 * The refs are the ones the vendored adapters already declare
 * (`credentialRef` defaults in `vendor/deepinfra/lib/index.js` and
 * `vendor/exaone/lib/index.js`), so the migrated profile needs no new
 * vocabulary.
 */
export const MIGRATION_TARGETS = Object.freeze([
  Object.freeze({ row: 'dsh-deepinfra', ref: 'DEEPINFRA_API_KEY', label: 'DeepInfra' }),
  Object.freeze({ row: 'dsh-exaone', ref: 'EXAONE_API_KEY', label: 'EXAONE' }),
])

/** A reference name outside this grammar is not addressable by the store. */
export const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The row header of one managed vendor row, at any indentation. */
const rowHeader = (row) => new RegExp(`^(\\s*)${row}:\\s*$`)

/** One `apiKey:` line: the indent, the separator, and the value. */
const apiKeyLine = /^(\s*)apiKey:(\s*)(\S.*?)\s*$/

/**
 * The shape a value is reported in. A value never leaves this module itself.
 * @param {unknown} value - the secret.
 * @returns {string} a redacted shape.
 */
export function redact(value) {
  const text = typeof value === 'string' ? value : ''
  return `<redacted len=${text.length}>`
}

/**
 * Unwrap a value that may be a reactive Cordis config node.
 *
 * A volatile config field is `{ get(): value }`, not a plain value, and
 * spreading it yields accessor noise. The same unwrapping the router's
 * `configValue()` performs, kept local so this module stays importable
 * without the plugin body.
 * @param {unknown} node - the candidate value.
 * @returns {unknown} the plain value.
 */
export function unwrap(node) {
  if (node !== null && typeof node === 'object' && typeof node.get === 'function') {
    const value = node.get()
    return value === undefined ? undefined : value
  }
  return node
}

/**
 * Read the plaintext key of one managed row out of a live `vendorConfig`.
 *
 * @param {unknown} vendorConfig - the router's live `vendorConfig` object.
 * @param {string} row - the row id.
 * @returns {{ref: string, row: string, value: string}|undefined} the finding.
 */
export function plaintextKeyIn(vendorConfig, row) {
  const scoped = unwrap(vendorConfig)
  if (scoped === null || typeof scoped !== 'object') return undefined
  const target = MIGRATION_TARGETS.find((entry) => entry.row === row)
  if (target === undefined) return undefined
  const rowConfig = unwrap(scoped[row])
  if (rowConfig === null || typeof rowConfig !== 'object') return undefined
  const value = unwrap(rowConfig.apiKey)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === '""' || trimmed === "''") return undefined
  return { row: target.row, ref: target.ref, value: trimmed }
}

/**
 * Plan the migration over the patch text.
 *
 * Only the FIRST `apiKey:` line directly under a managed row counts, and a row
 * must appear exactly once: two headers with the same id would make the edit
 * ambiguous, so the plan refuses rather than guess.
 *
 * @param {string} text - the profile patch text.
 * @param {readonly object[]} [targets] - the managed rows.
 * @returns {{plan: Array<object>, rows: Array<object>, problems: string[]}} the plan.
 */
export function planPlaintextKeyMigration(text, targets = MIGRATION_TARGETS) {
  const lines = text.split('\n')
  const plan = []
  const rows = []
  const problems = []

  for (const target of targets) {
    const pattern = rowHeader(target.row)
    const headers = []
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line)) headers.push(index)
    }
    if (headers.length === 0) {
      rows.push({ ...target, found: false, line: undefined })
      continue
    }
    if (headers.length > 1) {
      problems.push(`row "${target.row}" appears ${headers.length} times in the patch; the edit would be ambiguous`)
      rows.push({ ...target, found: false, line: undefined })
      continue
    }
    const headerIndex = headers[0]
    const headerIndent = lines[headerIndex].match(pattern)[1].length
    rows.push({ ...target, found: true, line: headerIndex + 1 })

    for (let index = headerIndex + 1; index < lines.length; index++) {
      const line = lines[index]
      if (line.trim().length === 0) continue
      const indent = line.match(/^(\s*)/)[1].length
      // A line at the header's own indent or shallower ends the row's block.
      if (indent <= headerIndent) break
      const match = line.match(apiKeyLine)
      if (match === null) continue
      const raw = match[3]
      const quoted = raw === '""' || raw === "''"
      const value = raw.replace(/^["']|["']$/g, '')
      if (!quoted && value.length === 0) {
        problems.push(`the apiKey line of row "${target.row}" carries an empty value; nothing to migrate`)
        break
      }
      if (value.length === 0) break
      plan.push({
        row: target.row,
        ref: target.ref,
        label: target.label,
        line: index + 1,
        indent: match[1],
        value,
      })
      break
    }
  }

  return { plan, rows, problems }
}

/**
 * Render the patch text with every planned plaintext line replaced by the
 * reference. Every other line is copied byte for byte.
 *
 * @param {string} text - the original patch text.
 * @param {readonly object[]} plan - the plan from {@link planPlaintextKeyMigration}.
 * @returns {string} the next patch text.
 */
export function renderPlaintextKeyRemoval(text, plan) {
  const lines = text.split('\n')
  for (const item of plan) {
    lines[item.line - 1] = `${item.indent}credentialRef: ${item.ref}`
  }
  return lines.join('\n')
}

/**
 * The backup path for one patch file.
 *
 * @param {string} patchPath - the patch file.
 * @param {Date} [when] - the timestamp.
 * @returns {string} an absolute backup path.
 */
export function backupPathFor(patchPath, when = new Date()) {
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return join(dirname(patchPath), `${patchPath.split('/').pop()}.bak.before-plaintext-key-migration-${stamp}`)
}

/**
 * Copy the patch file to a clearly named backup with owner-only permissions.
 *
 * @param {string} patchPath - the patch file.
 * @param {string} backupPath - the backup path.
 * @returns {Promise<string>} the backup path.
 */
export async function writeBackup(patchPath, backupPath) {
  await copyFile(patchPath, backupPath)
  await chmod(backupPath, 0o600)
  return backupPath
}

/**
 * Run the migration: back up, store, confirm, then edit.
 *
 * @param {object} options - the run options.
 * @param {string} options.patchPath - the profile patch file.
 * @param {readonly object[]} options.plan - the planned migrations.
 * @param {{set(ref: string, value: string): Promise<void>, resolve(ref: string): Promise<{value?: string}|undefined>}} options.store - the credential store.
 * @param {(path: string, text: string) => Promise<void>} options.writeFile - the atomic writer.
 * @param {string} [options.backupPath] - the backup path (defaults to a timestamped name).
 * @param {Date} [options.now] - the timestamp used for the backup name.
 * @returns {Promise<{migrated: Array<object>, backupPath: string, patchPath: string}>} the report.
 */
export async function runPlaintextKeyMigration({ patchPath, plan, store, writeFile, backupPath, now = new Date() }) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { migrated: [], backupPath: undefined, patchPath }
  }
  for (const item of plan) {
    if (!REF_PATTERN.test(item.ref)) throw new Error(`credential-migration: ref "${item.ref}" is not addressable`)
  }

  const backup = backupPath ?? backupPathFor(patchPath, now)
  await writeBackup(patchPath, backup)

  // 2+3: the store write, then the confirmation. A failure here leaves the
  // patch untouched: the plaintext key is still the live credential.
  for (const item of plan) {
    await store.set(item.ref, item.value)
    const resolved = await store.resolve(item.ref)
    if (resolved?.value !== item.value) {
      throw new Error(`credential-migration: ref "${item.ref}" did not resolve to the stored value; the plaintext key was left in place`)
    }
  }

  // 4: the edit itself.
  const original = await readFile(patchPath, 'utf8')
  const next = renderPlaintextKeyRemoval(original, plan)
  await writeFile(patchPath, next)

  return {
    migrated: plan.map((item) => ({
      row: item.row,
      ref: item.ref,
      lineBefore: item.line,
      lineAfter: item.line,
      value: redact(item.value),
    })),
    backupPath: backup,
    patchPath,
  }
}
