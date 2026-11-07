/**
 * Provider preset declarations — the measured instances of the common data model.
 *
 * Each preset answers the three owner questions in a standard shape
 * (see `preset-schema.js`):
 *   - **delivery**: `kind: 'package'` (code-backed, mounted as a child plugin)
 *     or `kind: 'declaration'` (JSON data only, no package);
 *   - **authentication**: `auth.mode` = `api-key` | `web-auth` |
 *     `local-socket` | `none`, with an ordered `sources` list;
 *   - **endpoint**: `mode` (http / local-http / daemon), `protocol`, `route`
 *     (host `pi-ai` or the vendor's own adapter), `baseUrl`, `transport`.
 *
 * Measured sources (2026-11-07): `dsh-antigravity` (`lib/auth.js`,
 * `lib/backends.js`), `dsh-opencode-v2` (`lib/http.js`), `dsh-deepinfra`
 * (`lib/adapter.js`, `lib/catalog.js`), and the host's `dsh-llm-pi-ai`
 * `PROTOCOLS`/`transport`.
 *
 * The module registers nothing and touches no context.
 *
 * @module @nolit/dsh-custom-router/presets
 */
import {
  AUTH_MODES,
  AUTH_SOURCES,
  CATALOG_MODES,
  CLI_SHAPES,
  DSH_PROTOCOLS,
  PLAN_STATES,
  PRESET_KINDS,
  TRANSPORTS,
  WIRE_PROTOCOLS,
  validatePresetModel,
} from './preset-schema.js'

export {
  AUTH_MODES,
  AUTH_SOURCES,
  CATALOG_MODES,
  CLI_SHAPES,
  DSH_PROTOCOLS,
  PLAN_STATES,
  PRESET_KINDS,
  TRANSPORTS,
  WIRE_PROTOCOLS,
}

/** A loader/settings row id (`preset-schema` keeps the same pattern private). */
const KEBAB = /^[a-z][a-z0-9-]*$/

/** Contract revision; bump when a declared field changes meaning. */
export const PRESET_CONTRACT_VERSION = 3

/**
 * The host's shared delegation tool. It is NOT a vendor package: it ships with
 * DSH itself and lives under the install tree, so it never resolves from a
 * profile's `node_modules` (measured 2026-11-07).
 */
export const TOOL_SUBAGENT_ROW = '@deepseek-ai/dsh-tool-subagent'

/** How a preset's wire is served (kept as a named constant for callers). */
export const ROUTES = Object.freeze(['pi-ai', 'own'])

/** Switch roles inside a preset. */
export const SWITCH_ROLES = Object.freeze(['master', 'model', 'subagent', 'cli', 'cli-mode', 'auxiliary'])

/** The three measured provider presets. */
export const PRESETS = Object.freeze([
  Object.freeze({
    id: 'antigravity',
    name: 'Antigravity',
    kind: 'package',
    package: '@nolit/dsh-antigravity',
    row: 'dsh-antigravity',
    // One preset = the rows the vendor bundle itself inserts. Measured against
    // the vendor's own bundle patch file (2 inserts) on 2026-11-07.
    entries: Object.freeze([
      Object.freeze({ row: 'dsh-antigravity' }),
      Object.freeze({
        row: 'tool-subagent-antigravity',
        specifier: TOOL_SUBAGENT_ROW,
        config: Object.freeze({ provider: 'antigravity', toolName: 'subagent_antigravity', maxDepth: 'provider-managed', modelSelection: true }),
      }),
    ]),
    providerId: 'antigravity',
    modelPrefixes: Object.freeze(['antigravity']),
    endpoint: Object.freeze({
      mode: 'http',
      protocol: 'google-generative-sse',
      route: 'own',
      baseUrl: 'https://cloudcode-pa.googleapis.com',
      transport: 'sse',
    }),
    auth: Object.freeze({
      mode: 'web-auth',
      sources: Object.freeze([
        Object.freeze({ kind: 'token-file', name: '~/.gemini/antigravity-cli/*.json' }),
        Object.freeze({ kind: 'secret-field', name: 'refreshToken' }),
        Object.freeze({ kind: 'secret-field', name: 'clientSecret' }),
        Object.freeze({ kind: 'env', name: 'ANTIGRAVITY_REFRESH_TOKEN' }),
      ]),
    }),
    catalog: Object.freeze({
      mode: 'live',
      layers: Object.freeze([
        // antigravity is absent from pi-ai's static snapshot; its account catalog is the probe.
        Object.freeze({ source: 'probe', kind: 'web-auth', shape: 'vendor', endpoint: '/v1internal:fetchAvailableModels', ttlMs: 900000 }),
      ]),
    }),
    switches: Object.freeze([
      Object.freeze({ name: 'enabled', module: 'index', role: 'master' }),
      Object.freeze({ name: 'modelServing', module: 'index', role: 'model' }),
      Object.freeze({ name: 'subagent', module: 'index', role: 'subagent' }),
      Object.freeze({ name: 'cliWorker', module: 'index', role: 'cli' }),
      Object.freeze({ name: 'workerEnabled', module: 'index', role: 'cli-mode' }),
      Object.freeze({ name: 'cliBatch', module: 'index', role: 'cli-mode', default: false }),
      Object.freeze({ name: 'usagePill', module: 'index', role: 'auxiliary' }),
    ]),
    surfaces: Object.freeze({
      model: Object.freeze({ adapter: true }),
      subagent: Object.freeze({
        toolRow: '@deepseek-ai/dsh-tool-subagent',
        toolName: 'subagent_antigravity',
        maxDepth: 'provider-managed',
      }),
      cli: Object.freeze({ shape: 'async', toolName: 'agy_worker', commandName: 'agy' }),
      batch: Object.freeze({ shape: 'sync', toolName: 'agy_cli', gate: 'cliBatch', default: false }),
      tools: Object.freeze(['agy_worker', 'agy_cli']),
      commands: Object.freeze(['agy']),
      skill: null,
    }),
    usage: Object.freeze({
      record: 'antigravity-usage',
      plan: 'available',
      billing: Object.freeze({
        mode: 'subscription',
        service: 'antigravity',
        windows: Object.freeze([Object.freeze({ label: '5h' }), Object.freeze({ label: 'weekly' }), Object.freeze({ label: 'monthly' })]),
      }),
    }),
  }),
  Object.freeze({
    id: 'opencode',
    name: 'OpenCode v2',
    kind: 'package',
    package: '@nolit/dsh-opencode-v2',
    row: 'dsh-opencode-v2',
    // Three rows, and the two OpenCode rows carry DIFFERENT live configs: the
    // index row is the CLI/delegation surface, the `/http` row is the native
    // model router. Mounting only the first is why `opencode-http-agent` was
    // missing (measured 2026-11-07).
    entries: Object.freeze([
      Object.freeze({ row: 'dsh-opencode-v2' }),
      Object.freeze({ row: 'dsh-opencode-v2-http', specifier: '@nolit/dsh-opencode-v2/http' }),
      Object.freeze({
        row: 'tool-subagent-opencode',
        specifier: TOOL_SUBAGENT_ROW,
        config: Object.freeze({ provider: 'opencode', toolName: 'subagent_opencode', maxDepth: 'provider-managed', modelSelection: true }),
      }),
    ]),
    providerId: 'opencode-http-agent',
    modelPrefixes: Object.freeze(['opencode-http-agent', 'opencode-go', 'opencode']),
    endpoint: Object.freeze({
      mode: 'daemon',
      protocol: 'openai-completions',
      route: 'own',
      baseUrl: '',
      chatPath: '/chat/completions',
      transport: 'sse',
    }),
    auth: Object.freeze({
      mode: 'web-auth',
      sources: Object.freeze([
        Object.freeze({ kind: 'daemon-endpoint', name: '/api/credential' }),
        Object.freeze({ kind: 'secret-field', name: 'apiKey' }),
        Object.freeze({ kind: 'secret-field', name: 'password' }),
        Object.freeze({ kind: 'env', name: 'OPENCODE_API_KEY' }),
      ]),
    }),
    catalog: Object.freeze({
      mode: 'live',
      layers: Object.freeze([
        Object.freeze({ source: 'upstream', providers: Object.freeze(['opencode', 'opencode-go']) }),
        Object.freeze({ source: 'probe', kind: 'api', shape: 'vendor', endpoint: '/api/model', ttlMs: 300000 }),
      ]),
    }),
    switches: Object.freeze([
      Object.freeze({ name: 'enabled', module: 'index', role: 'master' }),
      Object.freeze({ name: 'modelServing', module: 'http', role: 'model' }),
      Object.freeze({ name: 'subagent', module: 'index', role: 'subagent' }),
      Object.freeze({ name: 'cli', module: 'index', role: 'cli' }),
      Object.freeze({ name: 'workerEnabled', module: 'index', role: 'cli-mode' }),
    ]),
    surfaces: Object.freeze({
      model: Object.freeze({ adapter: true }),
      subagent: Object.freeze({
        toolRow: '@deepseek-ai/dsh-tool-subagent',
        toolName: 'subagent_opencode',
        maxDepth: 'provider-managed',
      }),
      cli: Object.freeze({ shape: 'sync', toolName: 'cli_worker', commandName: 'ocode' }),
      batch: null,
      tools: Object.freeze(['opencode', 'cli_worker']),
      commands: Object.freeze(['ocode']),
      skill: null,
    }),
    usage: Object.freeze({
      record: 'opencode-cost',
      plan: 'available',
      billing: Object.freeze({ mode: 'flat', service: 'opencode-v2', windows: Object.freeze([Object.freeze({ label: 'per-request' })]) }),
    }),
  }),
  Object.freeze({
    id: 'deepinfra',
    name: 'DeepInfra',
    kind: 'package',
    package: '@nolit/dsh-deepinfra',
    row: 'dsh-deepinfra',
    // Single-package preset: one entry, no shared rows (the vendor's own bundle
    // patch file has one insert). Kept explicit so every preset has the same shape.
    entries: Object.freeze([Object.freeze({ row: 'dsh-deepinfra' })]),
    providerId: 'deepinfra',
    modelPrefixes: Object.freeze(['deepinfra']),
    endpoint: Object.freeze({
      mode: 'http',
      protocol: 'openai-completions',
      route: 'own',
      baseUrl: 'https://api.deepinfra.com/v1/openai',
      chatPath: '/chat/completions',
      transport: 'sse',
    }),
    auth: Object.freeze({
      mode: 'api-key',
      sources: Object.freeze([
        Object.freeze({ kind: 'secret-field', name: 'apiKey' }),
        Object.freeze({ kind: 'env', name: 'DEEPINFRA_API_KEY' }),
      ]),
    }),
    catalog: Object.freeze({
      mode: 'live',
      layers: Object.freeze([
        Object.freeze({ source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models', ttlMs: 1800000 }),
      ]),
    }),
    switches: Object.freeze([]),
    surfaces: Object.freeze({
      model: Object.freeze({ adapter: true }),
      subagent: null,
      cli: null,
      batch: null,
      tools: Object.freeze([]),
      commands: Object.freeze([]),
      skill: null,
    }),
    usage: Object.freeze({ record: 'deepinfra-cost', plan: 'unavailable', billing: Object.freeze({ mode: 'pay-per-token' }) }),
  }),
])

/**
 * A pure-JSON provider preset (no package, no code): a local OpenAI-compatible
 * endpoint on loopback. This is the shape a new provider fills when the
 * operator only declares data.
 */
export const DECLARATION_EXAMPLE = Object.freeze({
  id: 'local-hub',
  name: 'Local Hub (loopback)',
  kind: 'declaration',
  row: 'custom-local-hub',
  // A declaration preset mounts nothing, so it declares no entries.
  entries: Object.freeze([]),
  providerId: 'local-hub',
  modelPrefixes: Object.freeze(['local-hub']),
  endpoint: Object.freeze({
    mode: 'local-http',
    protocol: 'openai-completions',
    route: 'pi-ai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    chatPath: '/chat/completions',
    transport: 'sse',
  }),
  auth: Object.freeze({ mode: 'none', sources: Object.freeze([]) }),
  catalog: Object.freeze({
    mode: 'static',
    layers: Object.freeze([
      Object.freeze({
        source: 'override',
        models: Object.freeze([Object.freeze({ id: 'default', name: 'Local Hub', contextWindow: 32768 })]),
      }),
    ]),
  }),
  switches: Object.freeze([]),
  surfaces: Object.freeze({
    model: Object.freeze({ adapter: true }),
    subagent: null,
    cli: null,
    batch: null,
    tools: Object.freeze([]),
    commands: Object.freeze([]),
    skill: null,
  }),
  usage: Object.freeze({ record: 'local-hub-usage', plan: 'unavailable', billing: Object.freeze({ mode: 'none' }) }),
})

/**
 * Find one preset by id.
 * @param {string} id - preset id.
 * @returns {object|undefined} the frozen declaration.
 */
export function findPreset(id) {
  return PRESETS.find((preset) => preset.id === id)
}

/**
 * Validate the `entries` list of one preset: the rows a preset mounts.
 *
 * An entry names a loader/settings row, an optional specifier and optional
 * static config. The rule that matters is that a `package` preset must declare
 * at least one entry — and must actually name a package — while a `declaration`
 * preset mounts nothing and must declare no entries. Entry rows are unique: two
 * entries with the same row would mount the same settings namespace twice.
 * @param {unknown} preset - candidate declaration.
 * @returns {string[]} validation errors.
 */
export function validateEntries(preset) {
  const errors = []
  const entries = preset?.entries
  if (preset?.kind === 'package') {
    // A package preset is mounted by name: without one there is nothing to import.
    if (typeof preset.package !== 'string' || preset.package === '') {
      errors.push('a package preset must name a package')
    }
  }
  if (entries === undefined) {
    // Back-compat: a preset without `entries` mounts its single package. The
    // package check above is what makes that fallback meaningful; a declaration
    // preset legitimately has no entries at all.
    return errors
  }
  if (!Array.isArray(entries)) return [...errors, 'entries must be an array']
  if (preset?.kind === 'package' && entries.length === 0) {
    return [...errors, 'a package preset requires at least one entry']
  }
  if (preset?.kind === 'declaration' && entries.length > 0) {
    errors.push('a declaration preset must not declare entries (it mounts nothing)')
  }
  const rows = new Set()
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') { errors.push('entries must be objects'); continue }
    if (typeof entry.row !== 'string' || !KEBAB.test(entry.row)) {
      errors.push('entry.row must be a loader row id')
    } else if (rows.has(entry.row)) {
      errors.push(`entry row "${entry.row}" is declared twice`)
    } else {
      rows.add(entry.row)
    }
    if (entry.specifier !== undefined && (typeof entry.specifier !== 'string' || entry.specifier === '')) {
      errors.push('entry.specifier must be a non-empty string when present')
    }
    if (entry.config !== undefined && (entry.config === null || typeof entry.config !== 'object')) {
      errors.push('entry.config must be an object when present')
    }
  }
  return errors
}

/**
 * Validate one preset declaration: the common data model plus the surface and
 * switch rules the host registries impose.
 * @param {unknown} preset - candidate declaration.
 * @returns {{ok: boolean, errors: string[]}} validation verdict.
 */
export function validatePreset(preset) {
  const model = validatePresetModel(preset)
  const errors = [...model.errors]
  if (preset === null || typeof preset !== 'object') return { ok: false, errors }

  const add = (message) => errors.push(message)
  for (const error of validateEntries(preset)) add(error)
  const surfaces = preset.surfaces
  if (surfaces === null || typeof surfaces !== 'object') {
    add('surfaces must be an object')
  } else {
    const tools = Array.isArray(surfaces.tools) ? surfaces.tools : []
    const commands = Array.isArray(surfaces.commands) ? surfaces.commands : []
    if (!Array.isArray(surfaces.tools)) add('surfaces.tools must be an array')
    if (!Array.isArray(surfaces.commands)) add('surfaces.commands must be an array')

    if (surfaces.subagent != null) {
      if (surfaces.subagent.toolRow !== '@deepseek-ai/dsh-tool-subagent') {
        add('subagent.toolRow must be the host shared tool "@deepseek-ai/dsh-tool-subagent"')
      }
      if (typeof surfaces.subagent.toolName !== 'string' || !/^subagent_[a-z0-9_]+$/.test(surfaces.subagent.toolName)) {
        add('subagent.toolName must match subagent_<provider>')
      }
      if (surfaces.subagent.maxDepth !== 'provider-managed' && !Number.isInteger(surfaces.subagent.maxDepth)) {
        add("subagent.maxDepth must be 'provider-managed' or an integer")
      }
    }

    if (surfaces.cli != null) {
      if (!CLI_SHAPES.includes(surfaces.cli.shape)) add(`cli.shape must be one of ${CLI_SHAPES.join(', ')}`)
      if (typeof surfaces.cli.toolName !== 'string' || surfaces.cli.toolName === '') add('cli.toolName must be a non-empty string')
      if (typeof surfaces.cli.commandName !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(surfaces.cli.commandName)) {
        add('cli.commandName must match the host command pattern /^[a-z][a-z0-9_-]*$/')
      }
      if (!tools.includes(surfaces.cli.toolName)) add('cli.toolName must appear in surfaces.tools')
      if (!commands.includes(surfaces.cli.commandName)) add('cli.commandName must appear in surfaces.commands')
    }

    if (surfaces.batch != null) {
      if (surfaces.batch.shape !== 'sync') add("batch.shape must be 'sync'")
      if (typeof surfaces.batch.toolName !== 'string' || surfaces.batch.toolName === '') add('batch.toolName must be a non-empty string')
      if (surfaces.cli != null && surfaces.cli.toolName === surfaces.batch.toolName) {
        add('cli.toolName and batch.toolName must differ')
      }
      if (!tools.includes(surfaces.batch.toolName)) add('batch.toolName must appear in surfaces.tools')
    }

    if (surfaces.skill != null) {
      if (typeof surfaces.skill.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(surfaces.skill.name)) {
        add('skill.name must be kebab-case')
      }
      const invocation = surfaces.skill.invocation
      if (invocation === null || typeof invocation !== 'object'
        || typeof invocation.modelInvocable !== 'boolean' || typeof invocation.userInvocable !== 'boolean') {
        add('skill.invocation must declare modelInvocable and userInvocable booleans')
      }
    }
  }

  if (!Array.isArray(preset.switches)) {
    add('switches must be an array')
  } else {
    for (const item of preset.switches) {
      if (item === null || typeof item !== 'object') { add('switch entries must be objects'); continue }
      if (typeof item.name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(item.name)) {
        add(`switch name must be camelCase, got "${String(item.name)}"`)
      }
      if (item.module !== 'index' && item.module !== 'http') add('switch.module must be "index" or "http"')
      if (!SWITCH_ROLES.includes(item.role)) add(`switch.role must be one of ${SWITCH_ROLES.join(', ')}`)
      if (item.default !== undefined && typeof item.default !== 'boolean') add('switch.default must be a boolean')
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Validate a list of presets, including cross-preset uniqueness (the host tool
 * and command registries are global, and a loader row has exactly one owner).
 * @param {readonly unknown[]} presets - candidate declarations.
 * @returns {{ok: boolean, errors: string[]}} validation verdict.
 */
export function validatePresets(presets) {
  const errors = []
  if (!Array.isArray(presets)) return { ok: false, errors: ['presets must be an array'] }
  const ids = new Set()
  const providerIds = new Set()
  const toolOwners = new Map()
  const commandOwners = new Map()
  const rowOwners = new Map()
  for (const preset of presets) {
    const verdict = validatePreset(preset)
    errors.push(...verdict.errors.map((error) => `${preset?.id ?? '<anonymous>'}: ${error}`))
    if (preset?.id !== undefined) {
      if (ids.has(preset.id)) errors.push(`duplicate preset id "${preset.id}"`)
      ids.add(preset.id)
    }
    if (preset?.providerId !== undefined) {
      if (providerIds.has(preset.providerId)) errors.push(`duplicate providerId "${preset.providerId}"`)
      providerIds.add(preset.providerId)
    }
    // A loader row is a settings namespace: two presets claiming one row would
    // register it twice when both activate. One row, one owner.
    for (const entry of Array.isArray(preset?.entries) ? preset.entries : []) {
      if (typeof entry?.row !== 'string') continue
      if (rowOwners.has(entry.row) && rowOwners.get(entry.row) !== preset?.id) {
        errors.push(`row "${entry.row}" is claimed by both "${rowOwners.get(entry.row)}" and "${preset?.id}"`)
      }
      rowOwners.set(entry.row, preset?.id)
    }
    for (const tool of preset?.surfaces?.tools ?? []) {
      if (toolOwners.has(tool) && toolOwners.get(tool) !== preset.id) {
        errors.push(`tool "${tool}" is claimed by both "${toolOwners.get(tool)}" and "${preset.id}"`)
      }
      toolOwners.set(tool, preset.id)
    }
    for (const command of preset?.surfaces?.commands ?? []) {
      if (commandOwners.has(command) && commandOwners.get(command) !== preset.id) {
        errors.push(`command "${command}" is claimed by both "${commandOwners.get(command)}" and "${preset.id}"`)
      }
      commandOwners.set(command, preset.id)
    }
  }
  return { ok: errors.length === 0, errors }
}
