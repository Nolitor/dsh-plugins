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
 * Read the first daemon state file that parses AND whose daemon is still alive.
 *
 * Measured 2026-11-08: the vendor's own attach path (`ServerManager.attachCandidate`)
 * SKIPS a state file whose `pid` is not running, and only then tries the next
 * candidate. This reader did not: it returned the first file that parsed, so a
 * STALE state file (dead pid) shadowed the live daemon that a later candidate
 * pointed at. Measured with a synthetic stale-then-live pair: this reader
 * returned `http://127.0.0.1:1` (the dead daemon) while the vendor attach
 * reached the live one.
 *
 * The liveness check is the same one the vendor uses (`process.kill(pid, 0)`),
 * and a state file WITHOUT a pid is accepted (nothing to check).
 *
 * The pid SHAPE is tightened here: only a positive integer is a pid. Everything
 * else follows the vendor's own measured behaviour — see {@link pidIsLive}.
 *
 * @param {string[]} candidates - state-file paths.
 * @param {(path: string) => Promise<string>} read - file reader (injectable).
 * @param {(pid: number) => boolean} alive - liveness probe (injectable; default `process.kill(pid, 0)`).
 * @returns {Promise<{url: string, password: string, path: string}|undefined>} the state.
 */
export async function readDaemonState(candidates, read = readFile, alive = defaultAlive) {
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(await read(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.url === 'string' && parsed.url !== '') {
        if (!pidIsLive(parsed.pid, alive)) continue
        return { url: parsed.url, password: typeof parsed.password === 'string' ? parsed.password : '', path }
      }
    } catch {
      // A missing or half-written state file is not fatal: try the next candidate.
    }
  }
  return undefined
}

/**
 * Whether the state file's `pid` still names the daemon.
 *
 * MEASURED 2026-11-08 against the vendor's own attach path
 * (`ServerManager.attachCandidate`, `dsh-opencode-v2/lib/http.js:591-598`),
 * whose whole guard is:
 *
 *   if (state.pid) {
 *     try { process.kill(state.pid, 0) }
 *     catch { this.attachReason = `daemon pid ${state.pid} is not running`; return null }
 *   }
 *
 * Measured Node behaviour of `process.kill(pid, 0)`: a numeric string throws
 * `ESRCH` (no such process), a non-numeric pid throws `ERR_INVALID_ARG_TYPE`,
 * `0` and `-1` do NOT throw, and a fractional pid throws `ERR_INVALID_ARG_TYPE`.
 *
 * So the vendor ACCEPTS a falsy pid without a liveness check (it then validates
 * the daemon by probing `/api/info`), and SKIPS the file when a truthy pid's
 * liveness probe throws. This reader mirrors that, but only accepts a POSITIVE
 * INTEGER as a pid at all:
 *
 *   - positive integer → liveness-checked; a dead pid skips the file;
 *   - falsy pid (absent, `null`, `0`, `''`, `false`, `NaN`) → ACCEPTED
 *     WITHOUT a check, exactly like the vendor's `if (state.pid)` false branch
 *     (the daemon is then validated by the `/api/model` request the probe
 *     makes, which is this bridge's counterpart of the vendor's `/api/info`);
 *   - truthy non-integer pid (a string, a float) → the file is SKIPPED, like
 *     the vendor's `process.kill` throw.
 *
 * One deliberate deviation: a NEGATIVE pid is SKIPPED here. The vendor's
 * `process.kill(-1, 0)` succeeds because it signals every process the caller
 * may signal, so the vendor's check is vacuous there; this reader refuses the
 * file instead of reading a vacuous check as a liveness proof.
 *
 * @param {unknown} pid - the state file's `pid` field.
 * @param {(pid: number) => boolean} alive - liveness probe.
 * @returns {boolean} true when the file may be used.
 */
function pidIsLive(pid, alive) {
  if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) return alive(pid)
  if (pid) return false
  return true
}

/** Default liveness probe: a signal-0 ping, the same check the vendor uses. */
function defaultAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM'
  }
}

/**
 * Map one vendor model onto the router catalog shape.
 *
 * Measured 2026-11-08 against the live `opencode serve` control plane
 * (53 routes, daemon v2.2.6):
 *
 *   - `contextWindow` = `limit.context`, `maxTokens` = `limit.output` — both
 *     present on every route, and identical to the pi-ai upstream snapshot on
 *     all 48 covered routes (0 disagreements).
 *   - `input` = the route's declared `capabilities.input`, reduced to the host's
 *     `text|image` vocabulary (measured input sets include video/pdf/audio, which
 *     the host does not model — an image-capable route must not be advertised
 *     as text-only).
 *   - `reasoning` = true when the route advertises a reasoning LEVEL (a variant
 *     other than `none`) or names the wire's reasoning field; OMITTED otherwise,
 *     so the upstream layer's own flag survives the field-level merge instead of
 *     being overwritten with a measured `false` (measured: 10 routes are
 *     `reasoning: true` upstream but advertise no level; a probe-side `false`
 *     would have erased them — 0 conflicts under this rule).
 *   - `cost` = the route's price record. Measured: the daemon's `cost[]` array
 *     holds a tierless base record plus optional context tiers, and the rates
 *     are US$ per 1M tokens (the daemon's own billing divides by 1e6). The
 *     tier threshold is the daemon's `tier.size`, which is the SAME number the
 *     router's `calculateCost()` expects as `inputTokensAbove` (measured: the
 *     7 tiered routes carry byte-identical tiers to the upstream snapshot).
 *
 * @param {object} model - vendor model (see `modelFromApiEntry`).
 * @param {object} [options] - `{ cost }`: the raw daemon `cost[]` array, when
 *   the caller still has the raw payload.
 * @returns {object} catalog model.
 */
export function toCatalogModel(model, options = {}) {
  const entry = {
    id: model.id,
    name: model.name ?? model.id,
    input: Array.isArray(model.inputModalities) ? [...model.inputModalities] : ['text'],
  }
  if (typeof model.contextWindow === 'number' && model.contextWindow > 0) entry.contextWindow = model.contextWindow
  if (typeof model.maxTokens === 'number' && model.maxTokens > 0) entry.maxTokens = model.maxTokens
  if (typeof model.reasoningField === 'string') entry.reasoningField = model.reasoningField
  if (Array.isArray(model.variants)) entry.variants = [...model.variants]
  const reasoning = reasoningSupport(model)
  if (reasoning !== undefined) entry.reasoning = reasoning
  const cost = costFromDaemon(options.cost)
  if (cost !== undefined) entry.cost = cost
  return entry
}

/**
 * Whether a route supports reasoning, or `undefined` when the daemon does not
 * say. `undefined` means "unknown" and keeps the upstream layer's own flag.
 *
 * Measured 2026-11-08: a route advertises a reasoning level through its
 * `variants` (a level other than the literal `none`), and names the wire field
 * through `compatibility.reasoningField` (measured: 28 of 53 routes carry
 * `reasoning_content`).
 *
 * @param {object} model - vendor model (see `modelFromApiEntry`).
 * @returns {boolean|undefined} true / false / undefined (unknown).
 */
export function reasoningSupport(model) {
  const levels = Array.isArray(model?.variants) ? model.variants.filter((id) => typeof id === 'string' && id !== '') : []
  if (levels.some((id) => id !== 'none')) return true
  if (typeof model?.reasoningField === 'string' && model.reasoningField !== '') return true
  return undefined
}

/**
 * Map the daemon's `cost[]` array onto the router's cost record.
 *
 * Measured 2026-11-08 (daemon v2.2.6): `cost[]` holds one tierless base
 * record (`{input, output, cache:{read, write}}`) and, for 7 of 53 routes, one
 * record per context tier carrying `tier: {type:"context", size}`. The daemon's
 * own billing (measured from the opencode binary) picks the tier whose `size`
 * the total input exceeds, else the tierless record, and divides by 1e6 — the
 * same rule and the same scale as the router's `calculateCost()`.
 *
 * The router's own tier contract is `{inputTokensAbove, input, output,
 * cacheRead, cacheWrite}`, so `tier.size` becomes `inputTokensAbove`.
 *
 * @param {unknown} rawCost - the daemon's `cost[]` array.
 * @returns {object|undefined} the router cost record, or undefined when the
 *   daemon carries no price at all.
 */
export function costFromDaemon(rawCost) {
  if (!Array.isArray(rawCost) || rawCost.length === 0) return undefined
  const rates = (record) => ({
    input: numberOrUndefined(record?.input),
    output: numberOrUndefined(record?.output),
    cacheRead: numberOrUndefined(record?.cache?.read),
    cacheWrite: numberOrUndefined(record?.cache?.write),
  })
  const base = rawCost.find(isBaseRecord)
  const tiered = rawCost.filter((record) => isContextTier(record?.tier))
  if (!base && tiered.length === 0) return undefined
  const source = base ?? tiered[0]
  const cost = rates(source)
  // `calculateCost()` needs all four rates; a record missing one would throw
  // there. Measured 2026-11-08: every live record carries all four, so this
  // guard never fires today — it keeps a future partial record from turning a
  // price into a crash. An incomplete record is DROPPED, never padded with a
  // fabricated 0.
  if (!isCompleteCost(cost)) return undefined
  if (tiered.length > 0) {
    const tiers = tiered
      .map((record) => ({ inputTokensAbove: record.tier.size, ...rates(record) }))
      .filter((tier) => isCompleteCost(tier))
      .sort((left, right) => left.inputTokensAbove - right.inputTokensAbove)
    if (tiers.length > 0) cost.tiers = dedupeTierSizes(tiers)
  }
  return cost
}

/**
 * Whether a daemon cost record is the TIERLESS BASE record.
 *
 * The base record is the one the daemon bills with when no context tier
 * matches (`e.find((d) => d.tier === void 0)` in the vendor's billing
 * function). A record must be an object to be a record at all, so a `null`
 * or a primitive entry never counts as the base.
 *
 * @param {unknown} record - one entry of the daemon's `cost[]` array.
 * @returns {boolean} true for the tierless base record.
 */
function isBaseRecord(record) {
  if (record === null || typeof record !== 'object') return false
  return record.tier === undefined
}

/**
 * Whether a daemon tier is a CONTEXT tier.
 *
 * Measured 2026-11-08 from the opencode binary's own billing function
 * (`py(e, a)`), whose tier filter is:
 *
 *   e.filter((d) => d.tier?.type === "context" && s > d.tier.size)
 *
 * So only a tier whose `type` is exactly `"context"` is a context tier; a
 * tier of any other type (or a tier without a type) is NOT billable by the
 * daemon's context rule and must not become a router tier. Measured over the
 * live 53-route payload: the only tier type present is `"context"` (5 distinct
 * sizes across 7 routes), so this gate never rejects a live record today — it
 * keeps a future tier of another type out of the router's tier list.
 *
 * The threshold `size` must also be a non-negative integer, because the
 * router's tier contract carries `inputTokensAbove` as a plain number.
 *
 * @param {unknown} tier - the daemon's `tier` field.
 * @returns {boolean} true for a context tier with a usable threshold.
 */
function isContextTier(tier) {
  if (tier === null || typeof tier !== 'object') return false
  if (tier.type !== 'context') return false
  return typeof tier.size === 'number' && Number.isFinite(tier.size) && tier.size >= 0
}

/**
 * Collapse tiers that share one `inputTokensAbove` threshold.
 *
 * The daemon's own billing sorts the matching tiers by `tier.size` DESCENDING
 * and takes `[0]`. Measured on a tie (two tiers with the same `size`), the
 * daemon's `toSorted` is STABLE, so it keeps the FIRST of the tied group in
 * the original array order.
 *
 * The router's own tier selector (`lib/cost.js` `ratesFor`) agrees: it walks
 * `tiers` and only replaces the matched rates when `tier.inputTokensAbove >
 * matchedThreshold`, a STRICT comparison — so the FIRST tier of a tied group
 * wins and the second is ignored. Measured 2026-11-08: `ratesFor` on two
 * tiers with `inputTokensAbove: 100` returns the first one, and reversing the
 * array returns the other one, i.e. the selector follows ARRAY ORDER.
 *
 * Both rules therefore keep the FIRST of a tied group, and that is what this
 * function does: the tied group keeps the tier that appeared FIRST in the
 * daemon's `cost[]` array. The contract was previously undefined; it is now
 * defined as "first wins", which matches the vendor's measured rule and the
 * router's own selector, so neither surprises the other.
 *
 * The tiers arrive here sorted ascending by threshold (a stable sort), so the
 * first of a tied group is the first in the daemon's array order.
 *
 * @param {object[]} tiers - tiers sorted ascending by `inputTokensAbove`.
 * @returns {object[]} the tiers, one per distinct threshold.
 */
function dedupeTierSizes(tiers) {
  const seen = new Set()
  const out = []
  for (const tier of tiers) {
    if (seen.has(tier.inputTokensAbove)) continue
    seen.add(tier.inputTokensAbove)
    out.push(tier)
  }
  return out
}

/** Whether a cost record carries all four rates as numbers. */
function isCompleteCost(cost) {
  return cost.input !== undefined && cost.output !== undefined
    && cost.cacheRead !== undefined && cost.cacheWrite !== undefined
}

/** A finite non-negative number, or undefined (never a fabricated 0). */
function numberOrUndefined(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
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
    // The vendor parser drops the price record, so the raw `cost[]` is indexed
    // by route id here and handed to the catalog mapping. Measured 2026-11-08:
    // the parsed id is exactly `${providerID}/${modelID}`, and the raw entry's
    // `id` and `modelID` are identical on all 53 routes.
    const rawById = indexRawEntries(payload)
    return {
      models: parsed.models.map((model) => toCatalogModel(model, { cost: rawById.get(model.id)?.cost })),
      measuredAt: new Date(now()).toISOString(),
      shape: 'vendor',
    }
  }
}

/**
 * Index the raw `/api/model` entries by their catalog id (`provider/model`).
 *
 * Measured 2026-11-08: the raw entries carry `providerID` plus `id`/`modelID`
 * (identical on all 53 live routes), and the vendor parser builds the id from
 * `providerID` + `modelID`.
 *
 * @param {unknown} payload - the raw `/api/model` body.
 * @returns {Map<string, object>} route id -> raw entry.
 */
function indexRawEntries(payload) {
  const index = new Map()
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const provider = typeof entry.providerID === 'string' ? entry.providerID : ''
    const model = typeof entry.modelID === 'string' ? entry.modelID : typeof entry.id === 'string' ? entry.id : ''
    if (!provider || !model) continue
    index.set(`${provider}/${model}`, entry)
  }
  return index
}
