#!/usr/bin/env node
/**
 * Specs gate: validate `specs/{protocols,providers,pricing}/*.json`, their
 * cross-references, and their freshness.
 *
 * Files:
 *   protocols/<wire>.json     stable wire ↔ canonical DSH mapping
 *   providers/<preset>.json   volatile vendor facts
 *   pricing/<preset>.json     the most volatile layer (plan / rates / source)
 *
 * Usage:
 *   node scripts/verify-specs.mjs [--root <dir>] [--now YYYY-MM-DD] [--warn] [--json]
 *
 * Exit codes: 0 clean (or --warn with only soft problems), 1 hard errors or
 * stale specs, 2 usage error / specs could not be loaded.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = resolve(HERE, '..')

const STATUSES = ['active', 'preview', 'deprecated', 'disabled']
/** Default `ttlDays` per collection (README: 90 / 90 / 30). */
export const DEFAULT_TTL = Object.freeze({ protocols: 90, providers: 90, pricing: 30 })
/** Singular label used in report rows. */
const SINGULAR = { protocols: 'protocol', providers: 'provider', pricing: 'pricing' }
const DAY_MS = 86_400_000

/** Manual `spec:watch` baseline committed next to the specs it protects. */
export const WATCH_LOCK_PATH = 'specs/upstream.lock.json'

/**
 * Default maximum age of that baseline. The documented manual cadence is at
 * least weekly (pricing `ttlDays` is 7), so 14 days means two missed cycles.
 */
export const DEFAULT_WATCH_MAX_AGE_DAYS = 14

// ------------------------------------------------------------------ dates

/** Coerce `YYYY-MM-DD`, an ISO string, or a Date into UTC epoch ms. */
function utcMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : NaN
  if (typeof value !== 'string' || value.trim() === '') return NaN
  const text = value.trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : NaN
}

/**
 * Whole days between `verifiedAt` and `now` (floor). Future dates yield
 * negative ages. Throws when either side is not a real date.
 */
export function ageDays(iso, now) {
  const verified = utcMs(iso)
  if (Number.isNaN(verified)) throw new Error(`invalid verifiedAt: ${String(iso)}`)
  const clock = utcMs(now)
  if (Number.isNaN(clock)) throw new Error(`invalid now: ${String(now)}`)
  return Math.floor((clock - verified) / DAY_MS)
}

// ------------------------------------------------------------------ loading

function readJsonDir(dir, kind, errors, files) {
  if (!existsSync(dir)) {
    errors.push(`${kind}: missing directory specs/${kind}`)
    return []
  }
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      out.push({ file: name, value })
      files[kind].push(`specs/${kind}/${name}`)
    } catch (error) {
      errors.push(`${kind}/${name}: ${error.message}`)
    }
  }
  return out
}

/**
 * Load every spec file under `root`. Missing directories or unparseable files
 * are reported in `errors` (never thrown).
 * @returns {{protocols: object[], providers: object[], pricing: object[], errors: string[], files: object}}
 */
export function loadSpecs({ root = DEFAULT_ROOT } = {}) {
  const base = resolve(root)
  const errors = []
  const files = { protocols: [], providers: [], pricing: [] }
  const protocols = readJsonDir(join(base, 'specs', 'protocols'), 'protocols', errors, files)
  const providers = readJsonDir(join(base, 'specs', 'providers'), 'providers', errors, files)
  const pricing = readJsonDir(join(base, 'specs', 'pricing'), 'pricing', errors, files)
  return { protocols, providers, pricing, errors, files, root: base }
}

/** Entries are `{file, value}`; expose the document either way. */
const docOf = (entry) => (entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry)
/** Unique id per collection: pricing files are keyed by `provider`, others by `id`. */
const idOf = (entry, kind) => {
  const doc = docOf(entry)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined
  return kind === 'pricing' ? doc.provider ?? doc.id : doc.id
}

// ------------------------------------------------------------------ schema

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Check one spec document against the README schema.
 * @returns {string[]} errors
 */
function checkSpec(kind, entry, errors) {
  const doc = docOf(entry)
  const label = `${kind}/${entry?.file ?? idOf(entry, kind) ?? '?'}`
  if (!isPlainObject(doc)) {
    errors.push(`${label}: document must be a JSON object`)
    return
  }
  const id = kind === 'pricing' ? doc.provider : doc.id
  if (!isNonEmptyString(id)) errors.push(`${label}: missing "${kind === 'pricing' ? 'provider' : 'id'}"`)
  if (!isNonEmptyString(doc.verifiedAt)) errors.push(`${label}: missing "verifiedAt"`)
  if (!isNonEmptyString(doc.docs) && kind !== 'pricing') errors.push(`${label}: "docs" must be a non-empty string`)
  if (!isPlainObject(doc.capabilities) && kind !== 'pricing') errors.push(`${label}: "capabilities" must be an object`)

  if (doc.ttlDays !== undefined && (!Number.isInteger(doc.ttlDays) || doc.ttlDays <= 0)) {
    errors.push(`${label}: "ttlDays" must be a positive integer`)
  }

  if (kind === 'providers') {
    if (!isNonEmptyString(doc.protocol)) errors.push(`${label}: missing "protocol"`)
    if (!isNonEmptyString(doc.pricing)) errors.push(`${label}: missing "pricing"`)
    if (!Array.isArray(doc.models) || doc.models.length === 0) errors.push(`${label}: "models" must be a non-empty array`)
    else if (doc.models.some((model) => !isNonEmptyString(model))) errors.push(`${label}: "models" entries must be non-empty strings`)
    if (!STATUSES.includes(doc.status)) errors.push(`${label}: "status" must be one of ${STATUSES.join('|')}`)
    if (doc.preset !== undefined && !isNonEmptyString(doc.preset)) errors.push(`${label}: "preset" must be a non-empty string`)
  }
  if (kind === 'protocols') {
    if (doc.revision !== undefined && !Number.isInteger(doc.revision)) errors.push(`${label}: "revision" must be an integer`)
    if (doc.adapters !== undefined && !Array.isArray(doc.adapters)) errors.push(`${label}: "adapters" must be an array`)
  }
  if (kind === 'pricing') {
    if (!isNonEmptyString(doc.kind)) errors.push(`${label}: missing "kind"`)
    if (doc.source !== undefined && typeof doc.source !== 'string') errors.push(`${label}: "source" must be a string`)
  }
}

/** Preset declarations from `lib/presets.js`, or null when they cannot be read. */
async function readPresets(root) {
  const path = join(root, 'lib', 'presets.js')
  if (!existsSync(path)) return null
  try {
    const mod = await import(pathToFileURL(path).href)
    if (!Array.isArray(mod.PRESETS)) return null
    return mod.PRESETS
  } catch {
    return null
  }
}


/**
 * The ONE explicit reconciliation between the two billing vocabularies.
 *
 * `specs/pricing/<id>.json` says `kind` (`subscription` / `flat` /
 * `live-catalog` / `free`) while `preset.usage.billing.mode` says `mode`
 * (`subscription` / `flat` / `pay-per-token` / `none`). They are different
 * words for the same fact, and nothing compared them: a pricing file could say
 * `free` while the preset bills per token and every gate stayed green. The map
 * below is the whole translation; a `kind` outside it is a VOCABULARY gap and
 * is reported as such instead of being silently accepted.
 */
export const PRICING_KIND_TO_BILLING_MODE = Object.freeze({
  subscription: 'subscription',
  flat: 'flat',
  'live-catalog': 'pay-per-token',
  free: 'none',
  none: 'none',
})

/**
 * Spec ↔ preset mirror check: the `specs/` layer is a SECOND registry, so every
 * fact it restates about a preset must equal the runtime declaration.
 *
 * Measured before this gate existed (2026-11-14): rewriting
 * `specs/providers/deepinfra.json` to a bogus endpoint, a different protocol or
 * another model id still exited 0, because the two registries were validated
 * independently and only joined by `preset` id. The mirror is therefore
 * checked field by field:
 *   - `specs/providers/<id>.json` exists for every preset id, and is that id;
 *   - `spec.protocol === preset.endpoint.protocol` and
 *     `spec.endpoint === preset.endpoint.baseUrl` — except `mode: 'daemon'`,
 *     whose base URL is resolved at runtime and legitimately absent;
 *   - `spec.pricing` names the preset's own pricing file, which exists;
 *   - `specs/pricing/<id>.kind` maps to `preset.usage.billing.mode` through
 *     {@link PRICING_KIND_TO_BILLING_MODE};
 *   - a STATIC model list (`catalog.layers[].models`) is a declaration and must
 *     equal `spec.models`; a live-catalog preset declares no ids, so only its
 *     non-empty `models` is enforced (there is nothing to compare to).
 * @param {object} specs - loaded specs.
 * @param {{presets?: readonly object[]}} [options] - declarations to mirror.
 * @returns {{errors: string[], warnings: string[]}} the verdict.
 */
export function checkPresetMirror(specs, { presets } = {}) {
  const errors = []
  const warnings = []
  if (!Array.isArray(presets) || presets.length === 0) return { errors, warnings }

  const knownIds = new Set(presets.map((preset) => preset?.id).filter(Boolean))
  const providers = new Map()
  for (const entry of specs?.providers ?? []) {
    const doc = docOf(entry)
    if (!isPlainObject(doc) || !isNonEmptyString(doc.id)) continue
    providers.set(doc.id, { doc, file: entry?.file })
  }
  const pricing = new Map()
  for (const entry of specs?.pricing ?? []) {
    const doc = docOf(entry)
    if (isPlainObject(doc) && isNonEmptyString(doc.provider)) pricing.set(doc.provider, { doc, file: entry?.file })
  }

  for (const preset of presets) {
    const id = preset?.id
    if (!isNonEmptyString(id)) continue
    const label = `preset ${id}`

    const mirror = providers.get(id)
    if (mirror === undefined) {
      errors.push(`${label}: no specs/providers/${id}.json — the spec layer must mirror every preset`)
      continue
    }
    const spec = mirror.doc
    // `file` is absent when a caller validates in-memory documents (tests do);
    // only compare it when the loader supplied one.
    const file = mirror.file ?? `${id}.json`
    if (mirror.file !== undefined && mirror.file !== `${id}.json`) {
      errors.push(`${label}: declared in specs/providers/${mirror.file}, expected ${id}.json`)
    }
    // A spec naming a DIFFERENT, EXISTING preset is a contradiction (two
    // presets joined to one spec). An unknown name is only a warning, reported
    // by the preset soft-check below, so this never masks that softer case.
    if (spec.preset !== undefined && spec.preset !== id && knownIds.has(spec.preset)) {
      errors.push(`${label}: specs/providers/${file} names preset "${String(spec.preset)}", which is another preset`)
    }

    const endpoint = preset?.endpoint ?? {}
    if (endpoint.mode !== 'daemon') {
      if (isNonEmptyString(endpoint.protocol) && spec.protocol !== endpoint.protocol) {
        errors.push(`${label}: specs/providers/${file} names protocol "${String(spec.protocol)}" but the preset speaks "${endpoint.protocol}"`)
      }
      if (isNonEmptyString(endpoint.baseUrl) && spec.endpoint !== endpoint.baseUrl) {
        errors.push(`${label}: specs/providers/${file} names endpoint "${String(spec.endpoint)}" but the preset serves "${endpoint.baseUrl}"`)
      }
    }

    if (isNonEmptyString(spec.pricing) && spec.pricing !== id) {
      errors.push(`${label}: "pricing" names "${spec.pricing}" but the preset's pricing file is specs/pricing/${id}.json`)
    }
    const price = pricing.get(id)
    if (price === undefined) {
      errors.push(`${label}: no specs/pricing/${id}.json — the preset's billing facts have no source file`)
    } else {
      const mapped = PRICING_KIND_TO_BILLING_MODE[price.doc.kind]
      const declared = preset?.usage?.billing?.mode
      if (mapped === undefined) {
        warnings.push(`${label}: specs/pricing/${id}.json kind "${String(price.doc.kind)}" is not in PRICING_KIND_TO_BILLING_MODE — add the mapping or fix the kind`)
      } else if (isNonEmptyString(declared) && mapped !== declared) {
        errors.push(`${label}: specs/pricing/${id}.json kind "${price.doc.kind}" maps to billing "${mapped}" but the preset declares usage.billing.mode "${declared}"`)
      }
    }

    // A declared (static) model list is a second registry of ids; a live
    // catalog preset declares none, so its spec's models are simply the last
    // measured subset and there is no counterpart to disagree with.
    const staticModels = []
    for (const layer of Array.isArray(preset?.catalog?.layers) ? preset.catalog.layers : []) {
      for (const model of Array.isArray(layer?.models) ? layer.models : []) {
        if (isNonEmptyString(model?.id)) staticModels.push(model.id)
      }
    }
    if (staticModels.length > 0 && Array.isArray(spec.models)) {
      for (const model of staticModels) {
        if (!spec.models.includes(model)) errors.push(`${label}: preset declares model "${model}" but specs/providers/${file} does not list it`)
      }
      for (const model of spec.models) {
        if (!staticModels.includes(model)) errors.push(`${label}: specs/providers/${file} lists model "${String(model)}" the preset does not declare`)
      }
    }
  }

  return { errors, warnings }
}

/**
 * Structural + cross-reference validation.
 * @returns {Promise<{errors: string[], warnings: string[]}>}
 */
export async function validateSpecs(specs, { root } = {}) {
  const errors = []
  const warnings = []
  const groups = ['protocols', 'providers', 'pricing']

  for (const kind of groups) {
    if (!Array.isArray(specs?.[kind])) {
      errors.push(`${kind}: missing collection`)
      continue
    }
    const seen = new Set()
    for (const entry of specs[kind]) {
      checkSpec(kind, entry, errors)
      const id = idOf(entry, kind)
      if (!isNonEmptyString(id)) continue
      if (seen.has(id)) errors.push(`${kind}: duplicate id "${id}"`)
      seen.add(id)
    }
  }

  const ids = {
    protocols: new Set((specs?.protocols ?? []).map((entry) => idOf(entry, 'protocols')).filter(Boolean)),
    providers: new Set((specs?.providers ?? []).map((entry) => idOf(entry, 'providers')).filter(Boolean)),
    pricing: new Set((specs?.pricing ?? []).map((entry) => idOf(entry, 'pricing')).filter(Boolean)),
  }

  for (const entry of specs?.providers ?? []) {
    const doc = docOf(entry)
    const label = `providers/${entry?.file ?? idOf(entry, 'providers') ?? '?'}`
    if (!isPlainObject(doc)) continue
    if (isNonEmptyString(doc.protocol) && !ids.protocols.has(doc.protocol)) {
      errors.push(`${label}: protocol "${doc.protocol}" not found in specs/protocols`)
    }
    if (isNonEmptyString(doc.pricing) && !ids.pricing.has(doc.pricing)) {
      errors.push(`${label}: pricing "${doc.pricing}" not found in specs/pricing`)
    }
  }

  for (const entry of specs?.pricing ?? []) {
    const doc = docOf(entry)
    if (!isPlainObject(doc)) continue
    if (isNonEmptyString(doc.provider) && !ids.providers.has(doc.provider)) {
      errors.push(`pricing/${entry?.file ?? idOf(entry, 'pricing') ?? '?'}: provider "${doc.provider}" not found in specs/providers`)
    }
  }

  // Soft check: the preset declaration is the runtime surface, but a missing or
  // unparseable `lib/presets.js` must not hide a real spec error behind a crash.
  const base = resolve(root ?? specs?.root ?? DEFAULT_ROOT)
  const presets = await readPresets(base)
  const known = presets === null ? null : new Set(presets.map((preset) => preset?.id).filter(Boolean))
  if (known) {
    for (const entry of specs?.providers ?? []) {
      const doc = docOf(entry)
      if (!isPlainObject(doc) || !isNonEmptyString(doc.preset)) continue
      if (!known.has(doc.preset)) {
        warnings.push(`providers/${entry?.file ?? idOf(entry, 'providers') ?? '?'}: preset "${doc.preset}" not found in lib/presets.js`)
      }
    }
  }
  // The mirror is a HARD check: a spec that contradicts the runtime preset is
  // not a freshness question, it is a wrong value that would be served.
  const mirror = checkPresetMirror(specs, { presets: presets ?? [] })
  errors.push(...mirror.errors)
  warnings.push(...mirror.warnings)

  return { errors, warnings }
}

// ------------------------------------------------------------------ freshness

/**
 * Stale detection. Provider/pricing staleness is a hard failure; a protocol is
 * only a failure when an adapter actually serves it.
 * @returns {{errors: string[], warnings: string[], stale: object[]}}
 */
export function checkFreshness(specs, now = new Date()) {
  const errors = []
  const warnings = []
  const stale = []
  const groups = ['protocols', 'providers', 'pricing']

  for (const kind of groups) {
    for (const entry of specs?.[kind] ?? []) {
      const doc = docOf(entry)
      if (!isPlainObject(doc)) continue
      const id = idOf(entry, kind) ?? entry?.file
      const label = `${kind}/${id}`
      let age
      try {
        age = ageDays(doc.verifiedAt, now)
      } catch (error) {
        errors.push(`${label}: ${error.message}`)
        continue
      }
      const ttlDays = Number.isInteger(doc.ttlDays) && doc.ttlDays > 0 ? doc.ttlDays : DEFAULT_TTL[kind]
      if (age <= ttlDays) continue // equal is fresh: strictly more than ttl is stale
      const served = kind !== 'protocols' || (Array.isArray(doc.adapters) && doc.adapters.length > 0)
      const record = { kind: SINGULAR[kind], id, age, ttlDays, level: served ? 'error' : 'warning' }
      stale.push(record)
      const message = `${label}: verifiedAt ${doc.verifiedAt} is ${age}d old (ttl ${ttlDays}d)`
      if (served) errors.push(message)
      else warnings.push(`${message} — no adapter serves this protocol`)
    }
  }

  return { errors, warnings, stale }
}

// ------------------------------------------------------------------ watch baseline

/**
 * Read the committed `specs/upstream.lock.json` baseline. A missing file is a
 * `null` baseline, not a throw: the check reports it, the gate still validates
 * the specs themselves.
 * @param {string} [root] - repository root.
 * @returns {{lock: object|null, path: string, error: string|null}} the baseline.
 */
export function loadWatchBaseline(root = DEFAULT_ROOT) {
  const path = join(resolve(root), WATCH_LOCK_PATH)
  if (!existsSync(path)) return { lock: null, path, error: null }
  try {
    return { lock: JSON.parse(readFileSync(path, 'utf8')), path, error: null }
  } catch (error) {
    return { lock: null, path, error: `${WATCH_LOCK_PATH}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Staleness of the manual `spec:watch` baseline. `spec:watch` is deliberately
 * not scheduled, so without this check a missed discovery cycle is invisible
 * until a hard deadline such as a pricing TTL.
 *
 * Warning by default (an offline or keyless machine must still pass); a hard
 * error with `strict`. A missing baseline is a warning unless `strict`, where it
 * is an error: the lock is committed, so absence is drift.
 * @param {object|null} lock - parsed `upstream.lock.json`, or null when absent.
 * @param {Date|string} [now] - clock.
 * @param {{maxAgeDays?: number, strict?: boolean}} [options] - limits.
 * @returns {{errors: string[], warnings: string[], watch: object}} the result.
 */
export function checkWatchBaseline(lock, now = new Date(), options = {}) {
  const maxAgeDays =
    Number.isInteger(options.maxAgeDays) && options.maxAgeDays > 0 ? options.maxAgeDays : DEFAULT_WATCH_MAX_AGE_DAYS
  const strict = options.strict === true
  const errors = []
  const warnings = []
  const missing = { generatedAt: null, age: null, maxAgeDays, ok: false }
  const push = (message) => (strict ? errors.push(message) : warnings.push(message))

  if (lock === null || lock === undefined) {
    push(`upstream watch: no ${WATCH_LOCK_PATH} baseline — run npm run spec:watch`)
    return { errors, warnings, watch: missing }
  }
  const generatedAt = lock?.generatedAt
  if (!isNonEmptyString(generatedAt)) {
    errors.push(`upstream watch: ${WATCH_LOCK_PATH} has no "generatedAt"`)
    return { errors, warnings, watch: missing }
  }
  let age
  try {
    // A baseline stamped later than the reference clock is fresh, not negative:
    // `now` defaults to the UTC date, so a lock made this evening can be "future".
    age = Math.max(0, ageDays(generatedAt, now))
  } catch (error) {
    errors.push(`upstream watch: ${error.message}`)
    return { errors, warnings, watch: { ...missing, generatedAt } }
  }
  const watch = { generatedAt, age, maxAgeDays, ok: age <= maxAgeDays }
  if (!watch.ok) {
    push(`upstream watch: baseline generatedAt ${generatedAt} is ${age}d old (max ${maxAgeDays}d) — run npm run spec:watch`)
  }
  return { errors, warnings, watch }
}

// ------------------------------------------------------------------ report

/** Human-readable, compact report for one run. */
export function renderReport(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2)
  const lines = []
  for (const error of result.errors ?? []) lines.push(`error: ${error}`)
  for (const warning of result.warnings ?? []) lines.push(`warn:  ${warning}`)
  if (result.watch) {
    const { generatedAt, age, maxAgeDays, ok } = result.watch
    const state = generatedAt === null ? 'MISSING' : ok ? 'OK' : 'STALE'
    lines.push(
      `watch: ${generatedAt === null ? 'no baseline' : `generatedAt ${generatedAt}, ${age}d old`} (max ${maxAgeDays}d) — ${state}`,
    )
  }
  const files = result.files ?? {}
  const count = (key) => (Array.isArray(files[key]) ? files[key].length : 0)
  lines.push(
    `specs: ${count('protocols')} protocols, ${count('providers')} providers, ${count('pricing')} pricing — ${
      result.ok ? 'OK' : 'FAILED'
    }`,
  )
  return lines.join('\n')
}

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const rootIndex = argv.indexOf('--root')
  return {
    root: rootIndex === -1 ? DEFAULT_ROOT : argv[rootIndex + 1],
    now: argv.includes('--now') ? argv[argv.indexOf('--now') + 1] : new Date().toISOString().slice(0, 10),
    warn: argv.includes('--warn'),
    json: argv.includes('--json'),
    strictWatch: argv.includes('--strict-watch'),
    watchMaxAge: argv.includes('--watch-max-age') ? Number(argv[argv.indexOf('--watch-max-age') + 1]) : DEFAULT_WATCH_MAX_AGE_DAYS,
  }
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'usage: node scripts/verify-specs.mjs [--root <dir>] [--now YYYY-MM-DD] [--warn] [--json] [--strict-watch] [--watch-max-age <days>]',
    )
    return 0
  }
  if (argv.includes('--root') && (!argv[argv.indexOf('--root') + 1] || argv[argv.indexOf('--root') + 1].startsWith('--'))) {
    console.error('verify-specs: --root requires a directory')
    return 2
  }
  if (argv.includes('--now') && !/^\d{4}-\d{2}-\d{2}$/.test(String(argv[argv.indexOf('--now') + 1] ?? ''))) {
    console.error('verify-specs: --now requires YYYY-MM-DD')
    return 2
  }
  if (argv.includes('--watch-max-age') && !/^\d+$/.test(String(argv[argv.indexOf('--watch-max-age') + 1] ?? ''))) {
    console.error('verify-specs: --watch-max-age requires a positive integer')
    return 2
  }

  const options = parseArgs(argv)
  const specs = loadSpecs({ root: options.root })
  if (specs.errors.length > 0) {
    const result = {
      ok: false,
      errors: specs.errors,
      warnings: [],
      stale: [],
      watch: { generatedAt: null, age: null, maxAgeDays: options.watchMaxAge, ok: false },
      files: specs.files,
      now: options.now,
    }
    if (options.json) console.log(JSON.stringify(result, null, 2))
    else console.error(renderReport(result))
    return 2
  }

  const validation = await validateSpecs(specs, { root: specs.root })
  const freshness = checkFreshness(specs, options.now)
  const baseline = loadWatchBaseline(specs.root ?? options.root)
  const watch = checkWatchBaseline(baseline.lock, options.now, {
    maxAgeDays: options.watchMaxAge,
    strict: options.strictWatch,
  })
  const errors = [...validation.errors, ...freshness.errors, ...(baseline.error ? [baseline.error] : []), ...watch.errors]
  const warnings = [...validation.warnings, ...freshness.warnings, ...watch.warnings]
  const ok = errors.length === 0
  const result = { ok, errors, warnings, stale: freshness.stale, watch: watch.watch, files: specs.files, now: options.now }

  if (options.json) console.log(JSON.stringify(result, null, 2))
  else console.log(renderReport(result))

  if (!ok && !options.warn) return 1
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`verify-specs: ${error.message}`)
    process.exit(2)
  })
}
