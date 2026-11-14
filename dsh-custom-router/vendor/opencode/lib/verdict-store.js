/**
 * Persisted entitlement verdicts for the OpenCode v2 settings tab.
 *
 * The sweep costs ~20 s for 49 routes, so it must not run on every settings
 * open. `measure` writes a snapshot here; `model-settings` serves it back so the
 * tab can show the last known usable/unavailable state (and sort by it) without
 * touching the backend. The operator refreshes it with the button.
 *
 * Storage follows the catalog rule: explicit config wins, then the active
 * profile directory, then `$DSH_HOME/cache`. With no profile and no home the
 * snapshot stays in memory (path `''`) and nothing is written.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { resolveCatalogPath } from './catalog-file.js'

/** Default file name of the persisted verdict snapshot. */
export const VERDICT_FILE_NAME = 'opencode-model-verdicts.json'

/**
 * @param {{ explicit?: string, profileDir?: string, dshHome?: string, fileName?: string }} options
 * @returns {string} Absolute path of the verdict file, or `''` when nowhere is safe.
 */
export function resolveVerdictPath({ explicit, profileDir, dshHome, fileName = VERDICT_FILE_NAME } = {}) {
  return resolveCatalogPath({ explicit, profileDir, dshHome, fileName })
}

/**
 * Build the reader/writer pair the settings routes use.
 *
 * @param {{ explicit?: string, profileDir?: string, dshHome?: string }} options
 * @returns {{ path: string, read: () => { verdicts: Record<string, string>, measuredAt: string | null }, write: (snapshot: { verdicts: Record<string, string>, measuredAt: string | null }) => boolean }}
 */
export function createVerdictStore({ explicit, profileDir, dshHome } = {}) {
  const path = resolveVerdictPath({ explicit, profileDir, dshHome })
  const empty = () => ({ verdicts: {}, measuredAt: null })
  return {
    path,
    read() {
      if (!path) return empty()
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        const verdicts = {}
        for (const [route, state] of Object.entries(raw?.verdicts ?? {})) {
          if (typeof route === 'string' && route.length > 0 && typeof state === 'string' && state.length > 0) {
            verdicts[route] = state
          }
        }
        const measuredAt = typeof raw?.measuredAt === 'string' && raw.measuredAt.length > 0 ? raw.measuredAt : null
        return { verdicts, measuredAt }
      } catch {
        // A missing or corrupt snapshot is simply "not measured yet".
        return empty()
      }
    },
    write(snapshot) {
      if (!path) return false
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(
          path,
          `${JSON.stringify({ verdicts: snapshot?.verdicts ?? {}, measuredAt: snapshot?.measuredAt ?? null }, null, 2)}\n`,
        )
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Collapse sweep results into the `route -> state` map the tab renders.
 *
 * @param {readonly { route?: string, state?: string }[]} results
 * @returns {Record<string, string>}
 */
export function verdictsFromResults(results) {
  const verdicts = {}
  for (const result of results ?? []) {
    const route = typeof result?.route === 'string' ? result.route : ''
    if (route.length === 0) continue
    verdicts[route] = typeof result?.state === 'string' && result.state.length > 0 ? result.state : 'error'
  }
  return verdicts
}
