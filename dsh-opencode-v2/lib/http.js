/**
 * OpenCode v2 **HTTP** provider — the same model backend as `./provider.js`, but
 * it speaks the OpenCode v2 server API instead of spawning `opencode run` per
 * generation.
 *
 * Measured v2.2.0 surface this file depends on:
 *   - `opencode serve --port 0` prints `server listening on http://host:port`
 *     and `server password <token>`; every `/api/*` request needs
 *     `Authorization: Basic base64(opencode:<password>)`.
 *   - `GET /api/model` -> `limit.context`, `limit.output`, `variants[]`.
 *   - `POST /api/session` with `model:{providerID,id,variant}`.
 *   - `POST /api/session/{id}/prompt {text}` returns immediately; the generation
 *     is observed on `GET /api/event?types=…` (SSE): `session.text.delta`,
 *     `session.reasoning.delta`, `session.step.ended` (exact tokens incl.
 *     `cache.read/write`), `session.execution.succeeded|failed|interrupted`,
 *     `permission.asked`.
 *   - `POST /api/session/{id}/permission/{rid}/reply {decision}`.
 *
 * Why: a long DSH transcript cannot be an argv element (128 KiB limit, see
 * VERIFICATION.md §13), a persistent session keeps the OpenCode-side history and
 * therefore reuses its prefix cache, and usage arrives inline.
 *
 * A session id is supplied by the host (`GenerateOptions.sessionId`), so one DSH
 * conversation maps onto one OpenCode session and later calls send only the new
 * user text.
 */
import { readFileSync } from 'node:fs'

import Schema from '@deepseek-ai/schemastery'

import {
  blocksToText,
  buildPrompt,
  sessionTitleText,
} from './provider.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  modelsFromApiPayload,
  reasoningEffortsFromVariants,
  unsupportedEffortMessage,
} from './shared.js'
import { CatalogLifecycle, CatalogStore, resolveCatalogPath } from './catalog-cache.js'
import { SessionMap } from './session-map.js'
import { createUsageLedger } from './usage-ledger.js'

/** Plugin name; the cordis row uses the `@nolit/dsh-opencode-v2/http` specifier. */
export const name = 'dsh-opencode-v2-http'

/** Services this plugin needs: the llm registry, and subprocess for the spawn path. */
export const inject = ['llm', 'subprocess']

/** Attribution headers are a host contract; fall back to none in unit tests. */
let attributionHeaders = () => ({})
try {
  const llm = await import('@deepseek-ai/dsh-llm')
  if (typeof llm.attributionHeaders === 'function') attributionHeaders = llm.attributionHeaders
} catch {
  /* unit tests run without the host package on the resolution path */
}

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG',
]

/** Content block index of the first reasoning/text block (odd/even split). */
const TEXT_INDEX_BASE = 0
const REASONING_INDEX_BASE = 1

export const Config = Schema.object({
  /** Explicit server URL; when empty the adapter attaches to the CLI daemon or spawns one. */
  baseUrl: Schema.string().default('').volatile(),
  /** Basic-auth password; with an empty value the state file or banner supplies it. */
  password: Schema.string().default('').volatile(),
  /** Where a running `opencode serve --service` publishes {url,pid,password}. */
  serviceStatePath: Schema.string()
    .default('')
    .volatile(),
  /** Attach to the CLI daemon when its state file is alive. */
  attachToDaemon: Schema.boolean().default(true).volatile(),
  /** Spawn `opencode serve --port 0` when nothing else is reachable. */
  spawnServer: Schema.boolean().default(true).volatile(),
  opencodePath: Schema.string().default('opencode').volatile(),
  spawnTimeoutMs: Schema.number().default(30000).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  cwd: Schema.string().default('').volatile(),
  /**
   * Route id used when the DSH model id is the literal `default`. The value is
   * a bare `provider/model` pair: the route id is split at the first `/`, so a
   * `#variant` suffix would become part of the model id. The reasoning level
   * comes from the DSH agent's own level, which the adapter maps onto this
   * route's advertised variants.
   */
  defaultModel: Schema.string().default('opencode-go/minimax-m3.1-flash').volatile(),
  /** Explicit route table, same shape as the CLI adapter's. */
  models: Schema.array(
    Schema.object({
      id: Schema.string(),
      opencodeModel: Schema.string().default(''),
      name: Schema.string().default(''),
    }),
  )
    .default([{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }])
    .volatile(),
  brief: Schema.string()
    .default(
      'You are OpenCode, an autonomous software-engineering agent, invoked as the model backend of another agent harness. The transcript of the calling conversation is below. Carry out the most recent user request end-to-end using your own tools and judgment. Do not ask questions — act autonomously. Your final printed answer is returned verbatim as the model\'s reply.',
    )
    .volatile(),
  /** Session-scoped permission rules forwarded to `POST /api/session`. */
  sessionPermissions: Schema.array(
    Schema.object({
      action: Schema.string(),
      resource: Schema.string(),
      effect: Schema.string(),
    }),
  )
    .default([])
    .volatile(),
  /** Decision used when OpenCode asks for a tool permission mid-generation. */
  permissionDecision: Schema.string().default('once').volatile(),
  timeoutMs: Schema.number().default(1800000).volatile(),
  requestTimeoutMs: Schema.number().default(30000).volatile(),
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  /** Snapshot file holding the last good catalog; empty resolves under the active profile. */
  catalogPath: Schema.string().default('').volatile(),
  /** Background catalog sync period in ms; 0 keeps refreshes demand-driven only. */
  catalogSyncMs: Schema.number().default(300000).volatile(),
  /**
   * DSH-session → OpenCode-session map persisted next to the catalog. A
   * resumed DSH session reuses its OpenCode session instead of replaying the
   * whole transcript; empty resolves under the active profile.
   */
  sessionMapPath: Schema.string().default('').volatile(),
  /** Local session titles avoid a second model call for the title. */
  localSessionTitles: Schema.boolean().default(true).volatile(),
})

/** Join URL and path without doubling slashes. */
function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`
}

/** Basic auth header for `opencode:<password>`. */
export function authHeader(password) {
  return `Basic ${Buffer.from(`opencode:${password ?? ''}`).toString('base64')}`
}

/** `provider/id` -> OpenCode model ref; `default` maps through the route table. */
export function modelRefFromRoute(route, table, defaultModel) {
  const entry = (table ?? []).find((item) => item.id === route)
  const resolved = route === 'default' ? entry?.opencodeModel || defaultModel || '' : entry?.opencodeModel || route
  if (!resolved) return null
  const slash = resolved.indexOf('/')
  if (slash <= 0) return null
  return { providerID: resolved.slice(0, slash), id: resolved.slice(slash + 1) }
}

/** Stable key for "same OpenCode model + variant". */
export function modelKey(ref, variant) {
  return ref ? `${ref.providerID}/${ref.id}${variant ? `#${variant}` : ''}` : ''
}

/**
 * Text of the trailing user message(s) in a host history — everything the
 * OpenCode session has not seen yet on a continued conversation.
 */
export function newUserText(messages) {
  const parts = []
  for (let i = (messages ?? []).length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'user') break
    const text = blocksToText(message.content)
    if (text.trim()) parts.unshift(text)
  }
  return parts.join('\n\n')
}

/** Parse one SSE block (`event:` optional, `data:` concatenated). */
export function parseSseBlock(block) {
  let data = ''
  for (const line of String(block).split(/\r?\n/)) {
    if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * Async iterator over the server's SSE event stream.
 * The caller closes it by aborting `signal`.
 */
async function* sseEvents(url, password, types, signal) {
  const query = (types ?? []).map((type) => `types=${encodeURIComponent(type)}`).join('&')
  const target = joinUrl(url, `/api/event${query ? `?${query}` : ''}`)
  const response = await fetch(target, {
    headers: { ...attributionHeaders(), authorization: authHeader(password), accept: 'text/event-stream' },
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`event stream failed: HTTP ${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let at
      while ((at = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const match = buffer.match(/\r?\n\r?\n/)
        const block = buffer.slice(0, at)
        buffer = buffer.slice(at + match[0].length)
        const event = parseSseBlock(block)
        if (event) yield event
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
  }
}

const EVENT_TYPES = [
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
  'session.text.started',
  'session.text.delta',
  'session.text.ended',
  'session.reasoning.started',
  'session.reasoning.delta',
  'session.reasoning.ended',
  'session.step.started',
  'session.step.ended',
  'session.usage.updated',
  'session.tool.called',
  'session.tool.success',
  'session.tool.failed',
  'permission.asked',
  'permission.replied',
]

/**
 * Resolve one OpenCode server endpoint for this adapter: explicit baseUrl with
 * an explicit password, the CLI daemon's published state, or a child we own.
 */
export class ServerManager {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.resolved = null
    this.child = null
    this.state = null
  }

  /** Absolute path of the CLI daemon's state file (explicit configuration). */
  stateFilePath() {
    return this.config.serviceStatePath.get()
  }

  /** Headers for one request to the resolved server. */
  headers() {
    return { ...attributionHeaders(), authorization: authHeader(this.resolved?.password ?? '') }
  }

  /**
   * Fetch `path` and parse JSON; throws on a non-2xx answer.
   *
   * A daemon we merely attached to can disappear (it is spawned on demand by
   * the CLI and dies with its parent). One network-level failure re-resolves
   * the endpoint and retries once, so the adapter picks up a new daemon or
   * spawns its own server instead of failing the turn.
   */
  async request(method, path, body, { signal, timeoutMs } = {}) {
    const endpoint = await this.ensure()
    try {
      return await this.requestOnce(endpoint, method, path, body, { signal, timeoutMs })
    } catch (error) {
      if (endpoint.owned || error.status || signal?.aborted) throw error
      this.resolved = null
      const refreshed = await this.ensure()
      return this.requestOnce(refreshed, method, path, body, { signal, timeoutMs })
    }
  }

  async requestOnce(endpoint, method, path, body, { signal, timeoutMs } = {}) {
    const controller = new AbortController()
    const timeout = AbortSignal.timeout(timeoutMs ?? this.config.requestTimeoutMs.get())
    const stop = signal ? AbortSignal.any([signal, timeout]) : timeout
    const onAbort = () => controller.abort()
    stop.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(joinUrl(endpoint.url, path), {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = text
        }
      }
      if (!response.ok) {
        const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
        const error = new Error(`opencode ${method} ${path} -> HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
        error.status = response.status
        throw error
      }
      return parsed
    } finally {
      stop.removeEventListener('abort', onAbort)
    }
  }

  /** Resolve once; concurrent callers share the same resolution. */
  async ensure() {
    if (this.resolved) return this.resolved
    if (!this.resolving) {
      this.resolving = this.resolve().finally(() => {
        this.resolving = undefined
      })
    }
    return this.resolving
  }

  async resolve() {
    const baseUrl = this.config.baseUrl.get()
    if (baseUrl) {
      const password = this.config.password.get()
      const url = baseUrl.replace(/\/+$/, '')
      const info = await probeServer(url, password)
      this.resolved = { url, password, owned: false, version: info?.version }
      return this.resolved
    }
    const reasons = []
    if (this.config.attachToDaemon.get()) {
      const attached = await this.attach()
      if (attached) {
        this.resolved = attached
        return attached
      }
      reasons.push(this.attachReason ?? 'the CLI daemon state file did not yield a reachable server')
    }
    if (!this.config.spawnServer.get()) {
      throw new Error(`no OpenCode server: ${reasons.join('; ') || 'baseUrl is empty'} and spawnServer is disabled`)
    }
    try {
      this.resolved = await this.spawn()
      return this.resolved
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `OpenCode server unavailable: ${[...reasons, `spawn failed (${detail})`].join('; ')}. ` +
          'Set opencodePath to an absolute executable path, or keep a daemon running.',
      )
    }
  }

  /**
   * Read the CLI daemon state file and verify that the server answers.
   *
   * A pid check alone is not enough: the daemon is spawned on demand by the
   * CLI and dies with its parent, so the state file can name a live pid whose
   * port is already gone. `/api/info` is the measured health probe.
   */
  async attach() {
    this.attachReason = null
    const failures = []
    for (const path of serviceStateCandidates(this.stateFilePath())) {
      const attached = await this.attachCandidate(path)
      if (attached) return attached
      if (this.attachReason) failures.push(`${path}: ${this.attachReason}`)
    }
    this.attachReason = failures.length
      ? `no reachable daemon state (${failures.join('; ')})`
      : 'no daemon state candidate'
    return null
  }

  /** Attach to the daemon described by one descriptor file. */
  async attachCandidate(path) {
    let state
    try {
      const raw = readFileSync(path, 'utf8')
      if (!raw) throw new Error('file is empty')
      state = JSON.parse(raw)
    } catch (error) {
      this.attachReason = `daemon state unreadable (${error instanceof Error ? error.message : String(error)})`
      return null
    }
    if (!state?.url || !state?.password) {
      this.attachReason = 'daemon state file has no url/password'
      return null
    }
    const url = String(state.url).replace(/\/+$/, '')
    const password = String(state.password)
    if (state.pid) {
      try {
        process.kill(state.pid, 0)
      } catch {
        this.attachReason = `daemon pid ${state.pid} is not running`
        return null
      }
    }
    const info = await probeServer(url, password)
    if (!info) {
      this.attachReason = `daemon at ${url} did not answer /api/info`
      return null
    }
    this.state = state
    return { url, password, owned: false, version: info.version }
  }


  /** Spawn `opencode serve --port 0`, read the banner, and keep the child. */
  async spawn() {
    if (!this.ctx?.subprocess) throw new Error('spawnServer needs ctx.subprocess')
    const env = {}
    for (const key of this.config.forwardEnv.get()) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.opencodePath.get(), env)
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, 'serve', '--hostname', '127.0.0.1', '--port', '0'],
      cwd: this.config.cwd.get() || process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      env,
    })
    this.child = handle
    const banner = await readBanner(handle, this.config.spawnTimeoutMs.get())
    if (!banner) {
      handle.terminate?.()
      this.child = null
      throw new Error('opencode serve did not print a usable banner')
    }
    const info = await probeServer(banner.url, banner.password)
    if (!info) {
      handle.terminate?.()
      this.child = null
      throw new Error('opencode serve banner did not answer /api/info')
    }
    return { url: banner.url, password: banner.password, owned: true, version: info.version }
  }

  /** Terminate the child we own (never a daemon we merely attached to). */
  dispose() {
    if (this.child) {
      try {
        this.child.terminate?.()
      } catch {
        /* already gone */
      }
      this.child = null
    }
    this.resolved = null
  }
}

/**
 * Descriptor files that may name an already-running OpenCode server, most
 * specific first. `opencode service` (v2) keeps its descriptor under the XDG
 * state or config root; older installs used `~/.local/state`. Attaching instead
 * of spawning keeps one daemon per user and preserves its sessions.
 *
 * @param {string} [configured] Explicit `serviceStatePath` from config.
 * @returns {string[]} De-duplicated candidate paths.
 */
export function serviceStateCandidates(configured = '') {
  const home = process.env.HOME ?? ''
  const stateHome = process.env.XDG_STATE_HOME || `${home}/.local/state`
  const configHome = process.env.XDG_CONFIG_HOME || `${home}/.config`
  const candidates = [
    configured,
    process.env.OPENCODE_SERVICE_STATE ?? '',
    `${stateHome}/opencode/service.json`,
    `${configHome}/opencode/service.json`,
  ]
  return [...new Set(candidates.filter((path) => typeof path === 'string' && path.length > 0))]
}

/**
 * Health probe for one server endpoint.
 *
 * `/api/info` is the measured liveness surface (`{"version","pid","urls"}`).
 * Returns the parsed info, or null when the server does not answer.
 *
 * @param {string} url - server base URL
 * @param {string} password - basic-auth password
 * @param {number} [timeoutMs] - probe budget
 * @returns {Promise<{version: string} | null>}
 */
export async function probeServer(url, password, timeoutMs = 3000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(joinUrl(url, '/api/info'), {
      headers: { ...attributionHeaders(), authorization: authHeader(password) },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const info = await response.json()
    return info?.version ? info : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Read the serve banner from a piped stdout within `timeoutMs`. */
export async function readBanner(handle, timeoutMs) {
  const stdout = handle?.stdout
  if (!stdout) return null
  const decoder = new TextDecoder()
  const timer = AbortSignal.timeout(timeoutMs)
  let buffer = ''
  const iterator = stdout[Symbol.asyncIterator]()
  try {
    for (;;) {
      const race = await Promise.race([
        iterator.next(),
        new Promise((resolve) => timer.addEventListener('abort', () => resolve({ done: true }), { once: true })),
      ])
      if (race.done) return parseBanner(buffer)
      buffer += decoder.decode(race.value, { stream: true })
      const banner = parseBanner(buffer)
      if (banner?.password) return banner
      if (buffer.length > 65536) return null
    }
  } catch {
    return null
  }
}

/** Extract url + password from the measured v2.2.0 banner. */
export function parseBanner(text) {
  const url = String(text ?? '').match(/server listening on (https?:\/\/\S+)/)
  if (!url) return null
  const password = String(text).match(/server password (\S+)/)
  return { url: url[1].replace(/\/+$/, ''), password: password ? password[1] : '' }
}

/** The HTTP-backed adapter. */
export class OpencodeHttpAdapter {
  /**
   * @param {*} ctx Host context (llm registry, subprocess, events).
   * @param {*} config Validated plugin configuration.
   * @param {{ providerId?: string, catalogFileName?: string }} [options]
   *   Route name announced on catalog changes and the snapshot file name.
   */
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.providerId = options.providerId ?? 'opencode-http-agent'
    this.server = new ServerManager(ctx, config)
    this.sessions = new Map()
    this.usage = createUsageLedger()
    this.sessionMap = new SessionMap(
      resolveCatalogPath({
        explicit: config.sessionMapPath.get(),
        profileDir: ctx?.get?.('profileContext')?.dir,
        dshHome: process.env.DSH_HOME,
        fileName: 'opencode-sessions.json',
      }),
    )
    this.catalogStore = new CatalogStore(
      resolveCatalogPath({
        explicit: config.catalogPath.get(),
        profileDir: ctx?.get?.('profileContext')?.dir,
        dshHome: process.env.DSH_HOME,
        fileName: options.catalogFileName ?? 'opencode-models.json',
      }),
    )
    this.catalog = new CatalogLifecycle({
      probe: () => this.discoverOnce(),
      store: this.catalogStore,
      cacheMs: () => this.config.discoveryCacheMs.get(),
      syncMs: () => this.config.catalogSyncMs.get(),
      onChanged: () => this.announce(),
      warn: (message) => ctx?.logger?.warn?.(message),
    })
  }

  /**
   * Load the durable catalog and start the background sync.
   *
   * The Web catalog read that follows boot answers from memory; the probe
   * replaces the snapshot when OpenCode's own list moved on.
   */
  warmStart() {
    this.catalog.seed()
    this.catalog.start()
  }

  /** Stop the background sync timer and the owned server. */
  dispose() {
    this.catalog.stop()
    this.server.dispose()
  }

  /** Tell connected clients that this provider's model list changed. */
  announce() {
    try {
      this.ctx?.emit?.('llm/models-updated', this.providerId)
    } catch (error) {
      this.ctx?.logger?.warn?.(`model catalog announcement failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode (HTTP)' }
  }

  providerRetryPolicy() {}

  imageRequestPricing() {}

  /**
   * Current route catalog without blocking on the daemon when a snapshot or a
   * previous result exists; stale reads revalidate in the background.
   */
  async discover() {
    if (!this.config.autoDiscoverModels.get()) return null
    return this.catalog.read()
  }

  async discoverOnce() {
    try {
      const payload = await this.server.request('GET', '/api/model')
      const result = modelsFromApiPayload(payload)
      if (result) {
        this.discoveryError = null
        return result
      }
      this.discoveryError = new Error('GET /api/model returned an unexpected payload')
      return null
    } catch (error) {
      this.discoveryError = error instanceof Error ? error : new Error(String(error))
      throw this.discoveryError
    }
  }

  /**
   * Advertise the routes this server can serve.
   *
   * A failed catalog fetch is reported instead of silently degrading to the
   * bare `default` pseudo-route: the host turns a thrown error into a visible
   * provider failure, so an operator sees *why* the list is empty.
   */
  /**
   * Human description of the transport and the serving build, so the model
   * list states which OpenCode version answers.
   */
  describe() {
    const version = this.server.resolved?.version
    return version ? `OpenCode server ${version} via HTTP API` : 'OpenCode via HTTP API'
  }

  async listModels(provider) {
    const discovered = await this.discover()
    const description = this.describe()
    if (discovered?.models?.length) {
      return [
        { provider, id: 'default', name: 'OpenCode (config default)', description, inputModalities: ['text'] },
        ...discovered.models.map((model) => ({
          provider,
          id: model.id,
          name: model.name,
          description,
          inputModalities: ['text'],
        })),
      ]
    }
    if (this.config.autoDiscoverModels.get()) {
      const reason = this.discoveryError?.message ?? 'the server returned no models'
      throw new Error(`OpenCode model catalog unavailable: ${reason}`)
    }
    return this.config.models.get().map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name || `OpenCode ${entry.id}`,
      description,
      inputModalities: ['text'],
    }))
  }

  async resolveModel(provider, model) {
    const found = await this.lookupModel(model)
    if (!found && model !== 'default' && this.config.autoDiscoverModels.get()) {
      this.ctx?.logger?.warn?.(`OpenCode route "${model}" is not in the served catalog`)
    }
    const efforts = found?.variants?.length ? reasoningEffortsFromVariants(found.variants) : []
    return {
      provider,
      id: model,
      name: found?.name ?? `OpenCode ${model}`,
      description: this.describe(),
      inputModalities: ['text'],
      context: { contextWindow: found?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: found?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(efforts.length ? { reasoning: { efforts } } : {}),
    }
  }

  async lookupModel(model) {
    const discovered = await this.discover()
    if (!discovered?.models?.length) return null
    // `default` has no catalog entry of its own: it runs through the same
    // resolution `stream()` uses, so its row must inherit the actual route's
    // context window and reasoning levels instead of the conservative floor.
    const ref = model === 'default'
      ? modelRefFromRoute('default', this.config.models.get(), this.config.defaultModel.get())
      : null
    const routeId = ref ? `${ref.providerID}/${ref.id}` : model
    return (
      discovered.models.find((entry) => entry.id === routeId) ??
      discovered.models.find((entry) => entry.id.endsWith(`/${routeId}`)) ??
      null
    )
  }

  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: (options) => this.stream(options) }
  }

  /** Resolve or create the OpenCode session that backs one DSH session. */
  /** Drop an in-memory and persisted mapping after a 404 or a failed switch. */
  forget(key) {
    if (!key) return
    this.sessions.delete(key)
    this.sessionMap.delete(key)
  }

  async sessionFor(key, ref, variant, directory) {
    const wanted = modelKey(ref, variant)
    // A resumed DSH session may still own its OpenCode session even though this
    // adapter instance is new: adopt the persisted id after the server confirms
    // it, so the first turn sends only the new user text instead of replaying
    // the transcript. A dead id (new daemon) is dropped and creation follows.
    if (key && !this.sessions.has(key)) {
      const persisted = this.sessionMap.get(key)
      if (persisted) {
        const directoryMatches = !persisted.directory || !directory || persisted.directory === directory
        if (directoryMatches) {
          try {
            await this.server.request('GET', `/api/session/${persisted.sessionID}`)
            this.sessions.set(key, {
              sessionID: persisted.sessionID,
              modelKey: persisted.modelKey ?? wanted,
              sent: true,
            })
          } catch (error) {
            if (error.status === 404) this.sessionMap.delete(key)
            else throw error
          }
        }
      }
    }
    const existing = key ? this.sessions.get(key) : null
    if (existing) {
      // A server restart (or an external delete) invalidates our mapping.
      if (existing.sent) {
        try {
          await this.server.request('GET', `/api/session/${existing.sessionID}`)
        } catch (error) {
          if (error.status === 404) this.forget(key)
          else throw error
        }
      }
      if (!this.sessions.get(key)) {
        // fall through to creation below
      } else if (existing.modelKey !== wanted) {
        try {
          await this.server.request('POST', `/api/session/${existing.sessionID}/model`, {
            model: { ...ref, ...(variant ? { variant } : {}) },
          })
          existing.modelKey = wanted
          this.sessionMap.set(key, {
            sessionID: existing.sessionID,
            modelKey: wanted,
            directory,
          })
        } catch (error) {
          if (error.status === 404) {
            this.forget(key)
          } else {
            throw error
          }
        }
      }
      if (this.sessions.get(key) === existing) return existing
    } else if (this.sessions.get(key)) {
      return this.sessions.get(key)
    }
    const created = await this.server.request('POST', '/api/session', {
      ...(key ? { title: `DSH ${String(key).slice(0, 8)}` } : {}),
      model: { ...ref, ...(variant ? { variant } : {}) },
      location: { directory },
      ...(this.config.sessionPermissions.get().length
        ? { permissions: this.config.sessionPermissions.get() }
        : {}),
    })
    const session = { sessionID: created.data.id, modelKey: wanted, sent: false }
    if (key) {
      this.sessions.set(key, session)
      this.sessionMap.set(key, { sessionID: session.sessionID, modelKey: wanted, directory })
    }
    return session
  }

  /**
   * Stream one generation over HTTP. Text/reasoning arrive as deltas;
   * `session.step.ended` supplies exact tokens; permission prompts are answered
   * by config. This is the only conversation pipeline: the CLI adapter is a
   * worker backend, not a fallback route.
   */
  async *stream(options) {
    if (options.purpose === 'session-title' && this.config.localSessionTitles.get()) {
      const text = sessionTitleText(options.messages).slice(0, 80)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const config = this.config
    const timeout = AbortSignal.timeout(config.timeoutMs.get())
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const sessionKey = options.sessionId ? String(options.sessionId) : ''
    const ref = modelRefFromRoute(options.model, config.models.get(), config.defaultModel.get())
    if (!ref) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_HTTP_MODEL', message: `unmapped route ${options.model}` } } }
      return
    }
    // Same guard as the CLI route: a level reaches the session model object only
    // when discovery advertised it. An unknown route stays unvalidated here
    // (discovery may be unavailable); a known route with no variants rejects.
    if (options.reasoningEffort !== undefined) {
      let found = null
      try {
        found = await this.lookupModel(options.model)
      } catch {
        /* discovery unavailable: leave the decision to the server */
      }
      if (found && !(found.variants ?? []).includes(options.reasoningEffort)) {
        const message = unsupportedEffortMessage(
          options.provider,
          options.model,
          options.reasoningEffort,
          found.variants ?? [],
        )
        this.ctx?.logger?.warn?.(`opencode-http-agent: ${message}`)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message } } }
        return
      }
    }

    // Aggregated blocks, keyed by "<kind>:<ordinal>" so a tool-using step can
    // open a fresh text/reasoning block on new indexes.
    const blocks = new Map()
    let nextText = TEXT_INDEX_BASE
    let nextReasoning = REASONING_INDEX_BASE
    const openBlock = (event, kind) => {
      const key = `${kind}:${event.data?.ordinal ?? 0}`
      const existing = blocks.get(key)
      if (existing) return existing
      const index = kind === 'reasoning' ? nextReasoning : nextText
      if (kind === 'reasoning') nextReasoning += 2
      else nextText += 2
      const block = { index, kind, text: '' }
      blocks.set(key, block)
      return block
    }
    const closeAll = function* () {
      for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
        yield { type: 'block-end', index: block.index, block: { type: block.kind, text: block.text } }
      }
      blocks.clear()
    }

    let session = null
    let ephemeral = false
    let usage = null
    let terminal = null
    const abortEvents = new AbortController()
    const onAbort = () => {
      abortEvents.abort()
      if (session?.sessionID) {
        this.server.request('POST', `/api/session/${session.sessionID}/interrupt`).catch(() => {})
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      const directory = config.cwd.get() || process.cwd()
      session = await this.sessionFor(sessionKey, ref, options.reasoningEffort, directory)
      ephemeral = !sessionKey
      const promptText = session.sent
        ? newUserText(options.messages) || buildPrompt(options, config.brief.get())
        : buildPrompt(options, config.brief.get())
      const endpoint = await this.server.ensure()
      const events = sseEvents(endpoint.url, endpoint.password, EVENT_TYPES, abortEvents.signal)
      // Begin the subscription before the prompt so early deltas are not lost.
      const firstEvent = events.next()
      firstEvent.catch(() => {})
      const startedAt = Date.now()
      try {
        await this.server.request('POST', `/api/session/${session.sessionID}/prompt`, { text: promptText }, { signal })
        session.sent = true
      } catch (error) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_HTTP', message: error.message } } }
        return
      }

      const accept = (event) =>
        event?.data?.sessionID === session.sessionID &&
        (typeof event.created !== 'number' || event.created >= startedAt - 2000)
      let gate = false
      let pending = firstEvent
      for (;;) {
        const step = await pending
        if (step.done) break
        if (options.signal?.aborted) {
          terminal = { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } }
          break
        }
        const event = step.value
        pending = events.next()
        pending.catch(() => {})
        if (!accept(event)) continue
        const type = event.type
        if (!gate && (type === 'session.execution.started' || type === 'session.inbox.enqueued' || type === 'session.step.started')) {
          gate = true
        }
        // Permission prompts are answered even before the text gate opens.
        if (type === 'permission.asked') {
          const requestID = event.data?.id
          const decision = config.permissionDecision.get()
          if (requestID && (decision === 'once' || decision === 'always' || decision === 'reject')) {
            this.server
              .request('POST', `/api/session/${session.sessionID}/permission/${requestID}/reply`, { decision })
              .catch(() => {})
          }
          continue
        }
        if (!gate) continue

        switch (type) {
          case 'session.reasoning.started':
          case 'session.text.started': {
            const kind = type.startsWith('session.reasoning') ? 'reasoning' : 'text'
            const block = openBlock(event, kind)
            yield { type: 'block-start', index: block.index, blockType: kind }
            break
          }
          case 'session.reasoning.delta':
          case 'session.text.delta': {
            const kind = type.startsWith('session.reasoning') ? 'reasoning' : 'text'
            const block = openBlock(event, kind)
            const delta = String(event.data?.delta ?? '')
            if (!delta) break
            block.text += delta
            yield { type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: block.index, text: delta }
            break
          }
          case 'session.reasoning.ended':
          case 'session.text.ended': {
            const kind = type.startsWith('session.reasoning') ? 'reasoning' : 'text'
            const block = openBlock(event, kind)
            if (!block.text && typeof event.data?.text === 'string') block.text = event.data.text
            yield { type: 'block-end', index: block.index, block: { type: kind, text: block.text } }
            blocks.delete(`${kind}:${event.data?.ordinal ?? 0}`)
            break
          }
          case 'session.step.ended': {
            const tokens = event.data?.tokens
            if (tokens) {
              // One DSH generation may contain many OpenCode steps (each an
              // upstream call). The host keeps the LAST `usage` chunk, so emit a
              // running total: the final chunk then carries the whole generation.
              usage = addUsage(usage, usageFromTokens(tokens))
              yield { type: 'usage', usage }
            }
            break
          }
          case 'session.execution.succeeded':
            terminal = { kind: 'stop' }
            break
          case 'session.execution.failed':
            terminal = {
              kind: 'error',
              failure: {
                code: 'OPENCODE_HTTP_FAILED',
                message: errorText(event.data?.error ?? event.data?.message),
              },
            }
            break
          case 'session.execution.interrupted':
            terminal = { kind: 'error', failure: { code: 'OPENCODE_INTERRUPTED', message: 'opencode execution was interrupted' } }
            break
          default:
            break
        }
        if (terminal) break
      }

      for (const chunk of closeAll()) yield chunk

      // The generation's own usage, measured by its steps. The ledger advances by
      // the same amount, so a later cumulative snapshot yields only the growth.
      if (usage && session?.sessionID) this.usage.steps(session.sessionID, usage)

      if (options.signal?.aborted) {
        terminal = { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } }
      } else if (!terminal) {
        terminal = timeout.aborted
          ? { kind: 'error', failure: { code: 'OPENCODE_TIMEOUT', message: `opencode exceeded timeoutMs=${config.timeoutMs.get()}` } }
          : { kind: 'error', failure: { code: 'OPENCODE_HTTP_FAILED', message: 'event stream ended before a terminal execution event' } }
      }
      if (!usage) {
        try {
          const info = await this.server.request('GET', `/api/session/${session.sessionID}`)
          if (info?.data?.tokens) {
            // The session's counters are cumulative; report only their growth
            // since this session's last report, never the whole session again.
            usage = this.usage.cumulative(session.sessionID, usageFromTokens(info.data.tokens))
            yield { type: 'usage', usage }
          }
        } catch {
          /* no usage disclosure is better than a guess */
        }
      }
      yield { type: 'finish', reason: terminal }
    } catch (error) {
      for (const chunk of closeAll()) yield chunk
      yield {
        type: 'finish',
        reason: options.signal?.aborted
          ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } }
          : {
              kind: 'error',
              failure: {
                code: 'OPENCODE_HTTP',
                message: error instanceof Error ? error.message : String(error),
              },
            },
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      abortEvents.abort()
      if (ephemeral && session?.sessionID) {
        this.server.request('DELETE', `/api/session/${session.sessionID}`).catch(() => {})
      }
    }
  }
}

/** Human text for a string, an Error-shaped object, or an arbitrary payload. */
export function errorText(value) {
  if (typeof value === 'string') return value
  const message = value && typeof value === 'object' ? value.message ?? value.error?.message : undefined
  if (typeof message === 'string') return message
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return 'opencode execution failed'
}

/** Map OpenCode `tokens` onto the host's disjoint TokenUsage buckets. */
export function usageFromTokens(tokens) {
  const usage = {
    inputTokens: Number(tokens?.input ?? 0),
    outputTokens: Number(tokens?.output ?? 0),
    reasoningTokens: Number(tokens?.reasoning ?? 0),
    cacheReadTokens: Number(tokens?.cache?.read ?? 0),
    cacheWriteTokens: Number(tokens?.cache?.write ?? 0),
  }
  usage.totalTokens =
    usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  return usage
}

/**
 * Sum two usage records bucket by bucket.
 *
 * One DSH generation spans many OpenCode steps, each reporting its own usage;
 * the host persists only the last chunk, so the adapter accumulates and yields
 * the running total instead of letting the final upstream call overwrite it.
 *
 * @param {{inputTokens:number,outputTokens:number,reasoningTokens:number,cacheReadTokens:number,cacheWriteTokens:number,totalTokens:number}|undefined} previous Running total so far.
 * @param {{inputTokens:number,outputTokens:number,reasoningTokens:number,cacheReadTokens:number,cacheWriteTokens:number,totalTokens:number}} next One step's usage.
 * @returns Summed usage over both records.
 */
export function addUsage(previous, next) {
  if (!previous) return next
  const sum = {
    inputTokens: previous.inputTokens + next.inputTokens,
    outputTokens: previous.outputTokens + next.outputTokens,
    reasoningTokens: (previous.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    cacheReadTokens: previous.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: previous.cacheWriteTokens + next.cacheWriteTokens,
  }
  sum.totalTokens = sum.inputTokens + sum.outputTokens + sum.reasoningTokens + sum.cacheReadTokens + sum.cacheWriteTokens
  return sum
}

/** Close any block indexes left open by an aborted stream (mirrors provider.js). */
function closeBlocks(state) {
  const chunks = []
  for (const [index, block] of state) {
    if (block.closed) continue
    block.closed = true
    chunks.push({ type: 'block-end', index, block: { type: block.type, text: block.text } })
  }
  return chunks
}

/**
 * Plugin body: register the `opencode-http-agent` route and expose it in the
 * configurable-provider directory so the Web Models page sees it.
 */
export function apply(ctx, config) {
  const adapter = new OpencodeHttpAdapter(ctx, config, { providerId: 'opencode-http-agent' })
  const registration = ctx.llm.registerAdapter(['opencode-http-agent'], adapter)
  ctx.llm.registerConfigurableProviders([
    {
      provider: 'opencode-http-agent',
      displayName: 'OpenCode (HTTP)',
      settingsNs: name,
      settingsPath: [],
    },
  ])
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      try {
        registration()
      } catch {
        /* already disposed */
      }
      adapter.dispose()
    }, 'dsh-opencode-v2-http: dispose adapter and owned server')
  }
  adapter.warmStart()
  return () => adapter.dispose()
}
