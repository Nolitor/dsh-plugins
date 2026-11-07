/**
 * OpenCode v2 vendor-probe bridge.
 *
 * The model list lives behind the local daemon: `GET {url}/api/model` with
 * `Basic opencode:<password>` (the password comes from the daemon state file
 * `opencode/service.json` or the plugin config). Payloads are parsed by the
 * vendor's own `modelsFromApiPayload` so the bridge never re-implements the
 * route/plan/name-disambiguation rules.
 *
 * Reused vendor exports:
 *   - `@nolit/dsh-opencode-v2/http` → `authHeader`, `serviceStateCandidates`
 *   - `lib/shared.js` (resolved by path) → `modelsFromApiPayload`
 *
 * Flexible slots (`vendorConfig.opencode`, reactive or plain):
 *   baseUrl?      daemon URL (else the state file)
 *   password?     daemon password (else the state file)
 *   serviceFile?  explicit state-file path
 *   extraHeaders? additional headers
 *
 * @module @nolit/dsh-custom-router/bridges/opencode
 */
import { readFile } from 'node:fs/promises'

import { ProbeError } from '../probe.js'

/** Read a config value from a reactive or plain object. */
function cfg(config, key, fallback) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/** Lower-case an extra header map. */
function headerMap(extra) {
  const headers = {}
  if (extra === null || typeof extra !== 'object') return headers
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[String(name).toLowerCase()] = String(value)
    }
  }
  return headers
}

/**
 * Read the first daemon state file that parses.
 * @param {string[]} candidates - state-file paths.
 * @param {(path: string) => Promise<string>} read - file reader (injectable).
 * @returns {Promise<{url: string, password: string, path: string}|undefined>} the state.
 */
export async function readDaemonState(candidates, read = readFile) {
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(await read(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.url === 'string' && parsed.url !== '') {
        return { url: parsed.url, password: typeof parsed.password === 'string' ? parsed.password : '', path }
      }
    } catch {
      // A missing or half-written state file is not fatal: try the next candidate.
    }
  }
  return undefined
}

/**
 * Map one vendor model onto the router catalog shape.
 * @param {object} model - vendor model (see `modelFromApiEntry`).
 * @returns {object} catalog model.
 */
export function toCatalogModel(model) {
  const entry = {
    id: model.id,
    name: model.name ?? model.id,
    input: Array.isArray(model.inputModalities) ? [...model.inputModalities] : ['text'],
  }
  if (typeof model.contextWindow === 'number' && model.contextWindow > 0) entry.contextWindow = model.contextWindow
  if (typeof model.maxTokens === 'number' && model.maxTokens > 0) entry.maxTokens = model.maxTokens
  if (typeof model.reasoningField === 'string') entry.reasoningField = model.reasoningField
  if (Array.isArray(model.variants)) entry.variants = [...model.variants]
  return entry
}

/**
 * Build the OpenCode daemon probe handler for `vendorProbes['opencode']`.
 * @param {object} options - `{ modules, env?, fetchImpl?, now?, readFile? }`.
 * @param {{http: object, shared: object}} options.modules - vendor modules.
 * @returns {(layer: object, options?: object) => Promise<{models: object[], measuredAt: string, shape: 'vendor'}>} the handler.
 */
export function createOpencodeProbe({ modules, env = process.env, fetchImpl = globalThis.fetch, now = Date.now, readFile: reader = readFile } = {}) {
  for (const [module, exportName] of [
    [modules?.http, 'authHeader'],
    [modules?.http, 'serviceStateCandidates'],
    [modules?.shared, 'modelsFromApiPayload'],
  ]) {
    if (typeof module?.[exportName] !== 'function') {
      throw new TypeError(`createOpencodeProbe requires the vendor export ${exportName}`)
    }
  }

  return async function opencodeProbe(layer, options = {}) {
    const config = options.vendorConfig ?? options.config ?? {}
    const explicitUrl = cfg(config, 'baseUrl')
    const explicitPassword = cfg(config, 'password')
    let url = typeof explicitUrl === 'string' && explicitUrl !== '' ? explicitUrl : undefined
    let password = typeof explicitPassword === 'string' ? explicitPassword : undefined

    if (url === undefined || password === undefined) {
      const candidates = modules.http.serviceStateCandidates(cfg(config, 'serviceFile') ?? cfg(config, 'serviceStatePath') ?? '')
      const state = await readDaemonState(candidates, reader)
      if (state === undefined) {
        throw new ProbeError('opencode probe found no daemon: pass vendorConfig.opencode.baseUrl or point serviceFile at opencode/service.json', 'PROBE_FAILED')
      }
      url ??= state.url
      password ??= state.password
    }

    const headers = {
      accept: 'application/json',
      authorization: modules.http.authHeader(password ?? ''),
      ...headerMap(cfg(config, 'extraHeaders', {})),
    }
    const endpoint = `${String(url).replace(/\/+$/, '')}/api/model`
    const requestFetch = options.fetchImpl ?? fetchImpl
    let response
    try {
      response = await requestFetch(endpoint, {
        method: 'GET',
        headers,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      throw new ProbeError(`opencode probe could not reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}`, 'PROBE_FAILED', error)
    }
    if (!response.ok) {
      throw new ProbeError(`opencode probe answered ${response.status}`, 'PROBE_FAILED')
    }
    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new ProbeError('opencode probe did not answer with JSON', 'PROBE_FAILED', error)
    }
    const parsed = modules.shared.modelsFromApiPayload(payload)
    if (parsed === null || !Array.isArray(parsed.models)) {
      throw new ProbeError('opencode /api/model returned an unexpected payload', 'PROBE_FAILED')
    }
    return {
      models: parsed.models.map(toCatalogModel),
      measuredAt: new Date(now()).toISOString(),
      shape: 'vendor',
    }
  }
}
