/**
 * Durable per-backend selection state for the user-run CLI commands.
 *
 * The last model (and its reasoning level) a user picked is remembered so a
 * bare `/agy <task>` or `/ocode <task>` repeats it. State is a small JSON file
 * under `$DSH_HOME`, shared by both worker plugins, keyed by backend.
 */
import { homedir } from 'node:os'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** File name inside the DSH home directory. */
const FILE_NAME = 'cli-worker-selection.json'

/**
 * Resolve the DSH home directory without importing the bootstrap module.
 * @returns {string} absolute home directory.
 */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Absolute path of the selection file.
 * @returns {string} file path.
 */
export function selectionPath() {
  return join(dshHome(), FILE_NAME)
}

/**
 * Read the whole selection document.
 * @returns {Promise<Record<string, object>>} backend key to selection map.
 */
async function readAll() {
  try {
    const text = await readFile(selectionPath(), 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // A missing or unreadable file means "no saved selection yet".
    return {}
  }
}

/**
 * Read the saved selection for one backend.
 * @param {string} backend - backend key such as `agy` or `ocode`.
 * @returns {Promise<Record<string, string>>} saved fields, empty when absent.
 */
export async function readSelection(backend) {
  const all = await readAll()
  const entry = all[backend]
  if (!entry || typeof entry !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

/**
 * Merge one backend's selection into the file atomically.
 * @param {string} backend - backend key such as `agy` or `ocode`.
 * @param {Record<string, string>} patch - fields to persist.
 * @returns {Promise<void>} resolves after the file is replaced.
 */
export async function writeSelection(backend, patch) {
  const all = await readAll()
  all[backend] = { ...(all[backend] ?? {}), ...patch }
  const path = selectionPath()
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}
