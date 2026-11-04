/**
 * Append-only load beacon for @nolit/dsh-antigravity.
 *
 * A version in a log line is not proof of which code a process loaded (F-23):
 * compare the serving pid's beacon with package.json. The version is read from
 * package.json, never duplicated as a constant (F-26).
 *
 * Disable with ANTIGRAVITY_BEACON=0. A beacon failure must never affect the
 * plugin.
 *
 * @module @nolit/dsh-antigravity/beacon
 */
import { appendFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Version read from this package's manifest. */
export const VERSION = require('../package.json').version

/** Shared beacon path; the status scripts read the same file. */
export const BEACON_PATH = '/tmp/antigravity-boot.jsonl'

/**
 * Append one beacon row.
 * @param event - `load` or `stream`.
 * @param detail - extra JSON fields.
 * @returns {void}
 */
export function bootBeacon(event, detail = {}) {
  if (process.env.ANTIGRAVITY_BEACON === '0') return
  try {
    const size = existsSync(BEACON_PATH) ? statSync(BEACON_PATH).size : 0
    if (size > 1_000_000) return
    appendFileSync(BEACON_PATH, JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      version: VERSION,
      event,
      ...detail,
    }) + '\n')
  } catch {
    /* a beacon must never affect the plugin */
  }
}
