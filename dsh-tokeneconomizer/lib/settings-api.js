/**
 * The read/write seam behind the TokenEconomizer settings page.
 *
 * One aggregate GET carries everything the page paints — modes, every threshold with its stored
 * value and engine default, the action list, mechanism status and the judge probe — so a page
 * load costs one engine round trip instead of N. `history_import` lives in that list as a
 * plugin-level action, not an engine config key: a whole-engine grep for it finds zero hits.
 * `on` is a write alias only (`MODE_ALIAS`), never a stored value. All engine access goes
 * through the injected `runEngine`; this module never writes `~/.tokeneconomizer/config.json`
 * itself, and every write is confirmed by re-reading `show` before the response is built.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The settings contract lives in a browser-safe module so the client half can read the same
// constants; this module re-exports them unchanged for Node callers.
import {
  SETTINGS_PATH, CONFIG_PATH, RESTORE_PATH, RESET_PATH, IMPORT_PATH,
  UPSTREAM_PATH, MODELS_PATH,
  MODE_KEY, MODE_VALUES, MODE_ALIAS, THRESHOLDS, ACTIONS,
  THRESHOLD_LABELS, MODE_SELECTS, MODEL_SLOTS, MODEL_SLOT_KEYS,
} from './settings-contract.js'
export {
  SETTINGS_PATH, CONFIG_PATH, RESTORE_PATH, RESET_PATH, IMPORT_PATH,
  UPSTREAM_PATH, MODELS_PATH,
  MODE_KEY, MODE_VALUES, MODE_ALIAS, THRESHOLDS, ACTIONS,
  THRESHOLD_LABELS, MODE_SELECTS, MODEL_SLOTS, MODEL_SLOT_KEYS,
}

/** How many finished import jobs stay readable. */
const IMPORT_HISTORY = 20

/**
 * Validate one threshold value against its declared type and range.
 *
 * Strings are coerced (a form posts text); anything not finite after coercion is rejected. This
 * never throws: a bad label or a bad value is an answer, not an exception.
 * @param {string} label - a `THRESHOLDS` label.
 * @param {unknown} raw - the posted value.
 * @returns {{ ok: boolean, value?: number, error?: string }} the coerced value or the reason.
 */
export function validateValue (label, raw) {
  const spec = THRESHOLDS[label]
  if (spec === undefined) return { ok: false, error: 'unknown key: ' + String(label) }
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: label + ': a value is required' }
  }
  const numeric = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(numeric)) return { ok: false, error: label + ': not a number: ' + String(raw) }
  if (spec.type === 'int' && !Number.isInteger(numeric)) {
    return { ok: false, error: label + ': expected an integer, got ' + String(raw) }
  }
  if (spec.min !== null && numeric < spec.min) {
    return { ok: false, error: label + ': must be at least ' + spec.min }
  }
  if (spec.max !== null && numeric > spec.max) {
    return { ok: false, error: label + ': must be at most ' + spec.max }
  }
  return { ok: true, value: spec.type === 'int' ? Math.trunc(numeric) : numeric }
}

/**
 * Validate one mechanism value, resolving the `on` write alias.
 * @param {string} mode - `microskills`, `toolprune` or `loopguard`.
 * @param {unknown} raw - the posted value.
 * @returns {{ ok: boolean, value?: string, error?: string }} the stored value or the reason.
 */
function validateMode (mode, raw) {
  const allowed = MODE_VALUES[mode]
  if (allowed === undefined) return { ok: false, error: 'unknown key: ' + String(mode) }
  const word = String(raw ?? '').trim().toLowerCase()
  if (word === 'on') return { ok: true, value: MODE_ALIAS[mode] }
  if (!allowed.includes(word)) {
    return { ok: false, error: mode + ': expected one of ' + allowed.join(', ') + ' (or on)' }
  }
  return { ok: true, value: word }
}

/**
 * Flatten an engine `config show` payload into leaf values keyed by their own name, with
 * `loopguard_thresholds.<name>` for the guard's threshold map.
 *
 * The engine nests the same names differently per mechanism (`microskills.microskills`,
 * `toolprune.toolprune_evidence`, `loopguard.thresholds.backstop_mult`), and a test may hand in
 * the flat form instead. One index serves both, and object-typed nodes are skipped so
 * `microskills` resolves to the leaf, not the wrapper.
 * @param {unknown} engineConfig - the parsed `show` payload.
 * @returns {Map<string, unknown>} leaf values.
 */
function engineValueIndex (engineConfig) {
  const index = new Map()
  const walk = (node, parent) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return
    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (key === 'thresholds' || key === 'pinned_thresholds' || key === 'loopguard_thresholds') {
          for (const [name, threshold] of Object.entries(value)) {
            index.set('loopguard_thresholds.' + name, threshold)
            index.set(name, threshold)
          }
        }
        walk(value, key)
        continue
      }
      index.set(key, value)
    }
  }
  walk(engineConfig, '')
  return index
}

/**
 * Read one threshold's stored value.
 * @param {Map<string, unknown>} index - flattened engine values.
 * @param {{key: string}} spec - the threshold spec.
 * @returns {{ present: boolean, value: unknown }} the stored value when the engine has it.
 */
function storedThreshold (index, spec) {
  const dotted = spec.key.startsWith('loopguard_thresholds.')
    ? spec.key.slice('loopguard_thresholds.'.length)
    : null
  const candidates = dotted === null ? [spec.key] : [spec.key, dotted]
  for (const candidate of candidates) {
    if (index.has(candidate)) {
      const value = index.get(candidate)
      if (value === null || value === undefined) continue
      return { present: true, value }
    }
  }
  return { present: false, value: spec.def }
}

/**
 * Compare the stored engine config against the declared defaults.
 *
 * `overrides` are the keys the engine is actually running away from the default — including an
 * extreme one such as the measured `loopguard_thresholds.gate_error_outputs: 100000`. `effective`
 * is what the page shows as current: the stored value, else the default.
 * @param {unknown} engineConfig - parsed `show` payload.
 * @returns {{ overrides: object, defaults: object, effective: object }} three views.
 */
export function diffAgainstDefaults (engineConfig) {
  const index = engineValueIndex(engineConfig)
  const overrides = {}
  const defaults = {}
  const effective = {}
  for (const [label, spec] of Object.entries(THRESHOLDS)) {
    const stored = storedThreshold(index, spec)
    const value = stored.present ? stored.value : spec.def
    effective[label] = value
    if (!stored.present || String(value) === String(spec.def)) defaults[label] = spec.def
    else overrides[label] = value
  }
  // A pinned guard threshold outside the declared set is still an override the operator set:
  // the measured live config pins `gate_error_outputs: 100000` and `gate_min_turns: 100000`.
  for (const label of pinnedExtras(engineConfig, index)) {
    const name = label.slice('loopguard.'.length)
    const value = index.has('loopguard_thresholds.' + name)
      ? index.get('loopguard_thresholds.' + name)
      : index.get(name)
    if (value === null || value === undefined) continue
    overrides[label] = value
    effective[label] = value
  }
  return { overrides, defaults, effective }
}

/**
 * The guard thresholds the engine reports as pinned but this module declares no label for.
 *
 * `loopguard.thresholds` carries every base threshold, so presence alone cannot tell a pinned key
 * from a base one; the engine's own `pinned` name list can. The measured live config pins
 * `gate_error_outputs: 100000` and `gate_min_turns: 100000`.
 * @param {unknown} engineConfig - parsed `show` payload.
 * @param {Map<string, unknown>} index - flattened engine values.
 * @returns {string[]} `loopguard.<name>` labels outside `THRESHOLDS`.
 */
function pinnedExtras (engineConfig, index) {
  const names = new Set()
  const collect = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) if (typeof item === 'string') names.add(item)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pinned' && Array.isArray(value)) {
        for (const item of value) if (typeof item === 'string') names.add(item)
        continue
      }
      collect(value)
    }
  }
  collect(engineConfig)
  const out = []
  for (const name of names) {
    const label = name.startsWith('loopguard.') ? name : 'loopguard.' + name
    if (THRESHOLDS[label] !== undefined) continue
    if (!index.has('loopguard_thresholds.' + name) && !index.has(name)) continue
    out.push(label)
  }
  return out.sort()
}

/**
 * Build the single aggregate body the settings page needs.
 *
 * One object, one round trip: the page must be able to paint modes, every threshold's stored
 * value against its default, the action list, mechanism status and the judge probe without
 * calling the host again.
 * @param {unknown} engineConfig - parsed `config show` payload.
 * @param {object} [mechanismStatus] - host-side mechanism state (may carry `judge`).
 * @returns {object} the read payload.
 */
export function buildReadPayload (engineConfig, mechanismStatus) {
  const index = engineValueIndex(engineConfig)
  const modes = {
    microskills: modeOf(index, 'microskills'),
    toolprune: modeOf(index, 'toolprune'),
    loopguard: modeOf(index, 'loopguard'),
  }
  const thresholds = {}
  for (const [label, spec] of Object.entries(THRESHOLDS)) {
    const stored = storedThreshold(index, spec)
    thresholds[label] = {
      value: stored.present ? stored.value : spec.def,
      default: spec.def,
      override: stored.present && String(stored.value) !== String(spec.def),
      type: spec.type,
      min: spec.min,
      max: spec.max,
    }
  }
  const status = mechanismStatus !== null && typeof mechanismStatus === 'object' ? mechanismStatus : {}
  const judge = judgeOf(status, index)
  return {
    ok: true,
    modes,
    thresholds,
    modelSlots: readModelSlots(index),
    actions: [...ACTIONS],
    mechanismStatus: { ...status, judgeAvailable: judge.available },
    judge,
  }
}

/**
 * The stored side-call model of each slot.
 *
 * The `default` slot is not an engine config key: it is the deployment's own route, so it is
 * reported as an empty value the page renders as "the deployment's default". The two mechanism
 * slots read the engine's own keys, and a key the engine has not stored reads as empty — the
 * same "nothing is pinned" state, not as a missing value.
 *
 * @param {Map<string, unknown>} index - flattened engine values.
 * @returns {Record<string, string>} the slot label to its stored model string.
 */
export function readModelSlots (index) {
  const out = {}
  for (const slot of MODEL_SLOT_KEYS) {
    const spec = MODEL_SLOTS[slot]
    if (spec === undefined || spec.engineKey === null) {
      out[spec.label] = ''
      continue
    }
    const stored = index.get(spec.engineKey)
    out[spec.label] = typeof stored === 'string' ? stored : ''
  }
  return out
}

/**
 * Validate one side-call model string.
 *
 * The engine takes a `provider/model` string: the provider route the DSH side call runs on, and
 * the model id within it. A string without a separator cannot name both, so it is refused here
 * rather than being written and silently ignored by the engine.
 *
 * @param {string} slot - the slot key.
 * @param {unknown} raw - the posted value.
 * @returns {{ ok: boolean, value?: string, error?: string }} the accepted value or the reason.
 */
export function validateModel (slot, raw) {
  const spec = MODEL_SLOTS[slot]
  if (spec === undefined) return { ok: false, error: 'unknown model slot: ' + String(slot) }
  const text = String(raw ?? '').trim()
  if (text.length === 0) return { ok: true, value: '' }
  const separator = text.indexOf('/')
  if (separator <= 0 || separator === text.length - 1) {
    return { ok: false, error: slot + ': expected "provider/model"' }
  }
  const provider = text.slice(0, separator)
  const model = text.slice(separator + 1)
  if (provider.trim().length === 0 || model.trim().length === 0) {
    return { ok: false, error: slot + ': expected "provider/model"' }
  }
  return { ok: true, value: provider.trim() + '/' + model.trim() }
}

/**
 * The stored mode of one mechanism.
 * @param {Map<string, unknown>} index - flattened engine values.
 * @param {string} mode - mechanism name.
 * @returns {string} the stored value, else `off`.
 */
function modeOf (index, mode) {
  const value = index.get(mode)
  if (value === null || value === undefined) return 'off'
  const word = String(value).trim().toLowerCase()
  if (word === 'on') return MODE_ALIAS[mode]
  return MODE_VALUES[mode].includes(word) ? word : 'off'
}

/**
 * The judge probe as the page displays it.
 *
 * A probe recorded by the host wins; otherwise the engine payload is consulted; otherwise the
 * judge is reported unavailable with the reason the caller supplied.
 * @param {object} mechanismStatus - host-side status.
 * @param {Map<string, unknown>} index - flattened engine values.
 * @returns {{ available: boolean, reason: string }} the probe.
 */
function judgeOf (mechanismStatus, index) {
  const recorded = mechanismStatus.judge
  if (recorded !== null && typeof recorded === 'object') {
    return {
      available: Boolean(recorded.available),
      reason: String(recorded.reason ?? (recorded.available ? '' : 'judge unavailable')),
    }
  }
  if (mechanismStatus.judgeAvailable !== undefined) {
    const available = Boolean(mechanismStatus.judgeAvailable)
    return { available, reason: String(mechanismStatus.judgeReason ?? (available ? '' : 'judge unavailable')) }
  }
  const fromEngine = index.get('judge')
  if (fromEngine !== null && typeof fromEngine === 'object') {
    return {
      available: Boolean(fromEngine.available),
      reason: String(fromEngine.reason ?? (fromEngine.available ? '' : 'judge unavailable')),
    }
  }
  return { available: false, reason: 'judge state not reported' }
}

/**
 * Register the six settings routes through the injected registrar.
 *
 * `runEngine(kind, args)` is the caller's child-process boundary to `te`; this module never
 * opens the engine config file. Every handler catches and answers JSON — a throw would cost the
 * caller's request, and the engine's own rejection text is copied into `error` verbatim.
 * @param {{
 *   runEngine: (kind: string, args: string[]) => Promise<unknown> | unknown,
 *   register: (method: string, path: string, handler: Function) => unknown,
 *   mechanismStatus?: object,
 *   mechanismStatusOf?: () => object,
 *   upstreamCheck?: () => Promise<object>,
 *   modelCatalog?: () => Promise<{ providers?: object[], failures?: object[] }>,
 *   log?: { warn: (text: string) => void },
 * }} options - injected engine boundary and route registrar.
 * @returns {{ routes: string[], disposeJobs: () => void }} the registered route names.
 */
export function createSettingsRoutes ({
  runEngine,
  register,
  mechanismStatus,
  mechanismStatusOf,
  upstreamCheck,
  modelCatalog,
  log = { warn () {} },
}) {
  if (typeof runEngine !== 'function') throw new TypeError('createSettingsRoutes: runEngine must be a function')
  if (typeof register !== 'function') throw new TypeError('createSettingsRoutes: register must be a function')

  const jobs = new Map()
  const order = []
  const routes = []

  const add = (method, path, handler) => {
    register(method, path, async (request, params) => {
      try {
        return await handler(request, params)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn?.('settings-api: ' + method + ' ' + path + ': ' + message)
        return json({ ok: false, error: message }, 500)
      }
    })
    routes.push(method + ' ' + path)
  }

  const status = () => {
    try {
      const fromCaller = typeof mechanismStatusOf === 'function' ? mechanismStatusOf() : mechanismStatus
      return fromCaller !== null && typeof fromCaller === 'object' ? fromCaller : {}
    } catch (error) {
      log.warn?.('settings-api: mechanism status unavailable: ' + (error instanceof Error ? error.message : String(error)))
      return {}
    }
  }

  add('GET', SETTINGS_PATH, async () => {
    const read = await readEngineConfig(runEngine)
    if (!read.ok) return json({ ok: false, error: read.error }, read.status)
    return json({ ...buildReadPayload(read.config, status()), ok: true }, 200)
  })

  add('POST', CONFIG_PATH, async (request) => {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400)
    const set = parsed.body?.set
    if (set === null || typeof set !== 'object' || Array.isArray(set)) {
      return json({ ok: false, error: 'body.set must be an object of { label: value }' }, 400)
    }
    const entries = Object.entries(set)
    if (entries.length === 0) return json({ ok: false, error: 'body.set is empty' }, 400)

    const results = []
    let wrote = false
    for (const [label, raw] of entries) {
      const modelSpec = MODEL_SLOTS[label]
      if (modelSpec !== undefined) {
        const checked = validateModel(label, raw)
        if (!checked.ok) {
          results.push({ key: label, ok: false, error: checked.error })
          continue
        }
        // The default slot is not an engine key: an empty value there means "the deployment's
        // own route", which is what an engine without the two mechanism keys already does.
        if (modelSpec.engineKey === null) {
          results.push({ key: label, ok: true, value: '' })
          continue
        }
        // An empty value unsets the key rather than writing an empty string, so the engine
        // falls back to the next source down — the same rule the other resets follow.
        const written = checked.value === ''
          ? await runEngineCommand(runEngine, 'unset', [modelSpec.engineKey])
          : await runEngineCommand(runEngine, 'set', [modelSpec.engineKey + '=' + checked.value])
        if (!written.ok) {
          results.push({ key: label, ok: false, error: written.error })
          continue
        }
        wrote = true
        results.push({ key: label, ok: true, value: checked.value })
        continue
      }
      if (THRESHOLDS[label] !== undefined) {
        const checked = validateValue(label, raw)
        if (!checked.ok) {
          results.push({ key: label, ok: false, error: checked.error })
          continue
        }
        const written = await runEngineCommand(runEngine, 'set', [THRESHOLDS[label].key + '=' + checked.value])
        if (!written.ok) {
          results.push({ key: label, ok: false, error: written.error })
          continue
        }
        wrote = true
        results.push({ key: label, ok: true, value: checked.value })
        continue
      }
      if (MODE_VALUES[label] !== undefined) {
        const checked = validateMode(label, raw)
        if (!checked.ok) {
          results.push({ key: label, ok: false, error: checked.error })
          continue
        }
        const written = await runEngineCommand(runEngine, 'set', [label + '=' + checked.value])
        if (!written.ok) {
          results.push({ key: label, ok: false, error: written.error })
          continue
        }
        wrote = true
        results.push({ key: label, ok: true, value: checked.value })
        continue
      }
      results.push({ key: label, ok: false, error: 'unknown key: ' + label })
    }

    // Confirm after write: the response carries the persisted value, never the posted one.
    if (!wrote) return json({ ok: false, results }, 400)
    const read = await readEngineConfig(runEngine)
    if (!read.ok) return json({ ok: false, results, error: read.error }, read.status)
    const index = engineValueIndex(read.config)
    for (const result of results) {
      if (!result.ok) continue
      const modelSpec = MODEL_SLOTS[result.key]
      if (modelSpec !== undefined) {
        // The default slot has no engine key, so the engine's own answer is the truth: an
        // empty value there is "the deployment's route", which is what was asked for.
        if (modelSpec.engineKey === null) continue
        const stored = index.get(modelSpec.engineKey)
        if (typeof stored === 'string') result.value = stored
        else {
          result.error = 'engine did not persist ' + result.key
          result.ok = false
        }
        continue
      }      const spec = THRESHOLDS[result.key]
      const stored = spec === undefined
        ? { present: index.has(result.key), value: index.get(result.key) }
        : storedThreshold(index, spec)
      if (stored.present) result.value = stored.value
      else result.error = 'engine did not persist ' + result.key
      if (!stored.present) result.ok = false
    }
    return json({ ok: results.some((result) => result.ok), results }, 200)
  })

  add('POST', RESTORE_PATH, async () => {
    const restored = await runEngineCommand(runEngine, 'restore', [])
    if (!restored.ok) return json({ ok: false, error: restored.error }, restored.status)
    const read = await readEngineConfig(runEngine)
    if (!read.ok) return json({ ok: false, error: read.error, output: restored.output }, read.status)
    return json({ ok: true, output: restored.output, modes: buildReadPayload(read.config, status()).modes }, 200)
  })

  add('POST', RESET_PATH, async (request) => {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400)
    const requested = parsed.body?.keys
    let keys
    if (requested === undefined) {
      keys = Object.values(THRESHOLDS).map((spec) => spec.key)
    } else if (Array.isArray(requested) && requested.every((key) => typeof key === 'string')) {
      keys = requested.map((key) => THRESHOLDS[key]?.key ?? key)
    } else {
      return json({ ok: false, error: 'body.keys must be an array of labels' }, 400)
    }
    const reset = await runEngineCommand(runEngine, 'unset', keys)
    if (!reset.ok) return json({ ok: false, error: reset.error }, reset.status)
    const read = await readEngineConfig(runEngine)
    if (!read.ok) return json({ ok: false, error: read.error, keys }, read.status)
    return json({ ok: true, keys, output: reset.output, thresholds: buildReadPayload(read.config, status()).thresholds }, 200)
  })

  // One path, two verbs. DSH rejects a second registration of the same path (measured:
  // `connection: exact Fetch route .../import is already registered`), and it also rejects a
  // `:param` segment, so the job id travels as `?jobId=` on this same route. POST starts a job,
  // GET reads one.
  add('POST', IMPORT_PATH, async (request) => {
    const parsed = await readJsonBody(request, { optional: true })
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400)
    const args = importArgs(parsed.body)
    if (!args.ok) return json({ ok: false, error: args.error }, 400)
    const jobId = startImportJob(runEngine, args.args, jobs, order, log)
    return json({ ok: true, jobId, status: 'running' }, 202)
  })

  add('GET', IMPORT_PATH, async (request) => {
    const jobId = jobIdFromRequest(request)
    if (typeof jobId !== 'string' || jobId.length === 0) {
      return json({ ok: false, error: 'jobId is required' }, 400)
    }
    const job = jobs.get(jobId)
    if (job === undefined) return json({ ok: false, error: 'unknown job: ' + jobId }, 404)
    // The child handle stays inside this module; the wire carries only the job's own fields.
    return json({
      ok: true,
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? null,
      code: job.code ?? null,
      output: job.output,
      error: job.error,
    }, 200)
  })

  // The upstream comparison. It answers 200 in every case — including the failure cases — so
  // the page renders "could not check" instead of an error state it would have to special-case.
  // The distinction is in `ok`: false means the question could not be answered, and the reasons
  // are in `errors`.
  add('GET', UPSTREAM_PATH, async () => {
    const check = typeof upstreamCheck === 'function'
      ? await upstreamCheck()
      : { ok: false, errors: ['the upstream check is not available in this deployment'], detail: 'the upstream check is not available in this deployment' }
    return json({ ...check, ok: check.ok === true }, 200)
  })

  // The provider/model pairs a side call may target. The host's own registry is the source:
  // `ctx.llm.listProviders()` and `ctx.llm.listModels(provider)` describe what this deployment
  // can actually route. A deployment with no registry answers an empty list, never a guess.
  add('GET', MODELS_PATH, async () => {
    let catalog = { providers: [], failures: [] }
    try {
      const listed = typeof modelCatalog === 'function' ? await modelCatalog() : null
      if (listed !== null && Array.isArray(listed.providers)) catalog = listed
    } catch (error) {
      log.warn?.('settings-api: model catalog unavailable: ' + (error instanceof Error ? error.message : String(error)))
    }
    return json({ ok: true, ...catalog }, 200)
  })

  return {
    routes,
    disposeJobs () {
      for (const job of jobs.values()) {
        if (job.child !== undefined && job.status === 'running') job.child.kill()
      }
      jobs.clear()
      order.length = 0
    },
  }
}

/**
 * One WHATWG Response carrying JSON — the same seam `devstats-server` uses.
 * @param {object} body - JSON-serializable payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
export function json (body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Run one engine command and normalize the three shapes a caller's boundary may return.
 * @param {Function} runEngine - the injected boundary.
 * @param {string} kind - command family (`show`, `set`, `unset`, `restore`).
 * @param {string[]} args - its arguments.
 * @returns {Promise<{ ok: boolean, output: string, error: string, status: number }>} normalized.
 */
async function runEngineCommand (runEngine, kind, args) {
  const fail = (error, status) => ({ ok: false, output: '', error, status })
  let raw
  try {
    raw = await runEngine(kind, args)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 502)
  }
  if (raw === null || raw === undefined) return fail('engine returned nothing for ' + kind, 502)
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.startsWith('{') || text.startsWith('[')) return { ok: true, output: text, error: '', status: 200 }
    return fail(text.length > 0 ? text : 'engine returned no output for ' + kind, 409)
  }
  if (typeof raw !== 'object') return { ok: true, output: String(raw), error: '', status: 200 }
  const output = typeof raw.stdout === 'string'
    ? raw.stdout
    : (typeof raw.output === 'string' ? raw.output : (raw.text === undefined ? '' : String(raw.text)))
  const stderr = typeof raw.stderr === 'string' ? raw.stderr : ''
  const code = typeof raw.code === 'number' ? raw.code : (typeof raw.exitCode === 'number' ? raw.exitCode : 0)
  if (raw.ok === false || code !== 0) {
    // Verbatim: the engine's own rejection text, not a paraphrase.
    const reason = typeof raw.error === 'string' && raw.error.length > 0 ? raw.error : (stderr.trim() || output.trim())
    return fail(reason.length > 0 ? reason : kind + ' rejected by the engine', 409)
  }
  if (raw.error !== undefined && raw.error !== null && raw.error !== '') return fail(String(raw.error), 409)
  return { ok: true, output: output.trim().length > 0 ? output : stderr, error: '', status: 200 }
}

/**
 * Read the engine config for the aggregate payload.
 * @param {Function} runEngine - the injected boundary.
 * @returns {Promise<{ ok: boolean, config?: object, error?: string, status?: number }>} parsed.
 */
async function readEngineConfig (runEngine) {
  const read = await runEngineCommand(runEngine, 'show', [])
  if (!read.ok) return { ok: false, error: read.error, status: read.status }
  const parsed = parseEngineJson(read.output)
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 502 }
  return { ok: true, config: parsed.value }
}

/**
 * Parse an engine JSON document, failing with the text it could not read.
 * @param {string} text - the engine's stdout.
 * @returns {{ ok: boolean, value?: object, error?: string }} parsed value or the reason.
 */
function parseEngineJson (text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length === 0) return { ok: false, error: 'engine printed nothing' }
  try {
    const value = JSON.parse(trimmed)
    if (value === null || typeof value !== 'object') return { ok: false, error: 'engine printed a non-object' }
    return { ok: true, value }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: 'engine printed unreadable JSON: ' + reason }
  }
}

/**
 * Read a JSON request body from either a WHATWG Request or a plain object.
 * @param {unknown} request - the request value the host passed.
 * @param {{ optional?: boolean }} [options] - allow an absent body.
 * @returns {Promise<{ ok: boolean, body?: object, error?: string }>} the body or the reason.
 */
async function readJsonBody (request, { optional = false } = {}) {
  if (request !== null && typeof request === 'object' && typeof request.json === 'function') {
    try {
      const body = await request.json()
      if (body === null || typeof body !== 'object') return { ok: false, error: 'request body must be a JSON object' }
      return { ok: true, body }
    } catch (error) {
      if (optional) return { ok: true, body: {} }
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false, error: 'request body is not valid JSON: ' + reason }
    }
  }
  const body = request?.body
  if (body === undefined || body === null || body === '') {
    if (optional) return { ok: true, body: {} }
    return { ok: false, error: 'a JSON body is required' }
  }
  if (typeof body === 'object') return { ok: true, body }
  try {
    const parsed = JSON.parse(String(body))
    if (parsed === null || typeof parsed !== 'object') return { ok: false, error: 'request body must be a JSON object' }
    return { ok: true, body: parsed }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: 'request body is not valid JSON: ' + reason }
  }
}

/**
 * Validate and normalize the `cold-start` arguments a request may add.
 * @param {object} body - parsed request body.
 * @returns {{ ok: boolean, args?: string[], error?: string }} accepted flags.
 */
function importArgs (body) {
  const requested = body?.args
  if (requested === undefined) return { ok: true, args: [] }
  if (!Array.isArray(requested) || !requested.every((arg) => typeof arg === 'string')) {
    return { ok: false, error: 'body.args must be an array of strings' }
  }
  const allowed = new Set([
    '--all', '--dry-run', '--reimport', '--include-missing', '--dsh-home', '--limit', '--only',
  ])
  const args = []
  for (let i = 0; i < requested.length; i += 1) {
    const arg = requested[i]
    if (!allowed.has(arg)) return { ok: false, error: 'unsupported cold-start argument: ' + arg }
    args.push(arg)
    if (arg === '--dsh-home' || arg === '--limit' || arg === '--only') {
      const value = requested[i + 1]
      if (typeof value !== 'string' || value.startsWith('--')) {
        return { ok: false, error: arg + ' needs a value' }
      }
      args.push(value)
      i += 1
    }
  }
  return { ok: true, args }
}

/**
 * Start the asynchronous `te-dsh cold-start` job behind the import route.
 * @param {Function} runEngine - unused by the child, kept in the signature for symmetry.
 * @param {string[]} args - validated cold-start flags.
 * @param {Map<string, object>} jobs - live job records.
 * @param {string[]} order - insertion order, oldest first.
 * @param {{ warn?: (text: string) => void }} log - warning sink.
 * @returns {string} the job id.
 */
function startImportJob (runEngine, args, jobs, order, log) {
  void runEngine
  const jobId = globalThis.crypto?.randomUUID?.() ?? 'import-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  const job = { jobId, status: 'running', startedAt: new Date().toISOString(), output: '', error: '' }
  jobs.set(jobId, job)
  order.push(jobId)
  while (order.length > IMPORT_HISTORY) {
    const dropped = order.shift()
    if (dropped !== undefined) jobs.delete(dropped)
  }
  try {
    const bin = new URL('../bin/te-dsh.mjs', import.meta.url)
    const child = spawn(process.execPath, [fileURLToPath(bin), 'cold-start', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    job.child = child
    const sink = (chunk) => {
      job.output = (job.output + String(chunk)).slice(-8000)
    }
    child.stdout?.on('data', sink)
    child.stderr?.on('data', (chunk) => {
      job.error = (job.error + String(chunk)).slice(-8000)
    })
    child.on('error', (error) => {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.finishedAt = new Date().toISOString()
    })
    child.on('close', (code) => {
      job.code = code
      job.status = code === 0 ? 'done' : 'failed'
      if (code !== 0 && job.error.length === 0) job.error = 'cold-start exited with code ' + code
      job.finishedAt = new Date().toISOString()
    })
  } catch (error) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
    job.finishedAt = new Date().toISOString()
    log.warn?.('settings-api: could not start cold-start: ' + job.error)
  }
  return jobId
}

/**
 * Pull a job id out of a request's query string.
 *
 * DSH exact Fetch routes reject path placeholders, so the id arrives as `?jobId=...`. A caller
 * that instead appends it to the path still resolves, because the tail is read as a fallback.
 * @param {unknown} request - the request.
 * @returns {string | undefined} the job id, or undefined when the request carries none.
 */
function jobIdFromRequest (request) {
  const url = request?.url
  if (typeof url !== 'string') return undefined
  let parsed
  try {
    parsed = new URL(url, 'http://localhost')
  } catch (error) {
    return undefined
  }
  const query = parsed.searchParams.get('jobId')
  if (typeof query === 'string' && query.length > 0) return query
  const tail = parsed.pathname.slice(IMPORT_PATH.length)
  const id = tail.startsWith('/') ? tail.slice(1) : tail
  return id.length > 0 ? decodeURIComponent(id) : undefined
}
