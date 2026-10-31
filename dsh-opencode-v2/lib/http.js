/**
 * OpenCode v2 **pure LLM adapter**.
 *
 * This file is deliberately NOT an OpenCode agent client. It uses the local
 * OpenCode server only as a control plane for model discovery, provider
 * metadata, and credentials, then calls the provider's OpenAI-compatible
 * `/chat/completions` endpoint directly.
 *
 * The DSH harness owns the agent loop: system prompt, tool schemas, tool
 * execution, approvals, session history, and the active workspace. The adapter
 * only translates DSH `GenerateOptions` into a raw chat request and translates
 * the provider's SSE deltas back into DSH `StreamChunk`s.
 *
 * Measured control-plane surface (OpenCode v2.2.0):
 *   - `GET /api/info`       -> liveness/version
 *   - `GET /api/model`      -> catalog: `limit.context`, `limit.output`, `variants[]`
 *   - `GET /api/provider/{id}` -> provider `settings.baseURL`, `headers`
 *   - `GET /api/credential` -> active credential (key or OAuth access token)
 *
 * Generation surface:
 *   - `POST {baseURL}/chat/completions` with `stream:true`,
 *     `stream_options.include_usage:true`, OpenAI messages/tools.
 *
 * Forbidden by policy (asserted by tests):
 *   - `POST /api/session/{id}/prompt` and `agent:"build"` session loops
 *   - persona `brief` strings or `[note: the caller declared ...]`
 *   - static `cwd` overrides for model context
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import Schema from '@deepseek-ai/schemastery'

import {
  blocksToText,
} from './provider.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  modelsFromApiPayload,
  reasoningEffortsFromVariants,
  unsupportedEffortMessage,
} from './shared.js'
import { CatalogLifecycle, CatalogStore, resolveCatalogPath } from './catalog-cache.js'
import { createVerdictStore } from './verdict-store.js'
import { PLANS, PLAN_PROVIDERS, NEW_MODEL_DAYS, isNewModel, orderModels, planOfRoute, rankingForRoutes, rankingFromDataIndex } from './plans.js'
import {
  decideRouterConflict,
  detectRouterConflicts,
  normalizeConflictPolicy,
} from './conflicts.js'
import { createInlineTagRouter, sanitizeProtocolText } from './inline-tags.js'

/** Plugin name; the cordis row uses the `@nolit/dsh-opencode-v2/http` specifier. */
export const name = 'dsh-opencode-v2-http'

/**
 * The llm registry, subprocess (local control-plane/server), live sessions (cwd),
 * and `connection` — the last one owns `ctx.connection.fetch`, which serves the
 * settings tab's routes. Declaring it is mandatory: reading an undeclared service
 * throws and takes the whole plugin entry down (measured in an isolated boot,
 * 2026-10-30). Hosts without it still boot; the routes are simply not registered.
 */
export const inject = ['llm', 'subprocess', 'sessions', 'connection', 'settings']

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

const TEXT_INDEX = 0
const REASONING_INDEX = 1
const TOOL_INDEX_BASE = 2
/**
 * Block index base for tool calls recovered from inline transcript notation.
 *
 * It sits far above the OpenAI `tool_calls` ordinals (`TOOL_INDEX_BASE + index *
 * 2`) so the two sources can never collide; the assembler keys by index and
 * keeps emission order, so a sparse index is safe (measured against
 * `dsh-llm` `BlockAssembler`).
 */
const INLINE_TOOL_INDEX_BASE = 1000

/** Version string of this module, for the load beacon. */
const VERSION = '0.7.5'

export const Config = Schema.object({
  /** Explicit local OpenCode server URL; empty attaches to the daemon or spawns one. */
  baseUrl: Schema.string().default('').volatile(),
  /** Basic-auth password for the local control-plane server. */
  password: Schema.string().default('').volatile(),
  /**
   * Reaction when a legacy OpenCode provider (`opencode-go` / `opencode`, e.g.
   * llm-pi-ai) is already registered, or another instance owns this provider.
   */
  conflictPolicy: Schema.string().default('warn').volatile(),
  /** Where a running `opencode serve --service` publishes {url,pid,password}. */
  serviceStatePath: Schema.string().default('').volatile(),
  attachToDaemon: Schema.boolean().default(true).volatile(),
  spawnServer: Schema.boolean().default(true).volatile(),
  opencodePath: Schema.string().default('opencode').volatile(),
  spawnTimeoutMs: Schema.number().default(30000).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  /**
   * Local server process cwd only. It is NEVER used as the model context
   * directory: DSH tools own the caller session's cwd.
   */
  cwd: Schema.string().default('').volatile(),
  defaultModel: Schema.string().default('opencode-go/minimax-m3.1-flash').volatile(),
  models: Schema.array(
    Schema.object({
      id: Schema.string(),
      opencodeModel: Schema.string().default(''),
      name: Schema.string().default(''),
    }),
  )
    .default([{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }])
    .volatile(),
  /** Local OpenCode provider id whose backend endpoint and credential are used. */
  backendProviderId: Schema.string().default('opencode-go').volatile(),
  /** Explicit OpenAI-compatible backend root; empty resolves from `/api/provider/{id}`. */
  backendBaseUrl: Schema.string().default('').volatile(),
  /** Explicit bearer token; empty uses OPENCODE_API_KEY or the local credential store. */
  apiKey: Schema.string().default('').volatile(),
  apiKeyEnv: Schema.string().default('OPENCODE_API_KEY').volatile(),
  /**
   * Credential-store label to pin for the backend credential (e.g. `Personal`).
   * Empty means "prefer an active oauth entry, then an active key entry".
   */
  credentialLabel: Schema.string().default('').volatile(),
  /** Header carrying the stable conversation id the Go backend routes on. */
  sessionHeader: Schema.string().default('x-opencode-session').volatile(),
  /** Value used when DSH dispatches without a session id (catalog/title probes). */
  sessionFallback: Schema.string().default('deepseek-harness').volatile(),
  /** Backend-model request path below `backendBaseUrl`. */
  chatPath: Schema.string().default('/chat/completions').volatile(),
  /** How long a resolved provider base/credential pair is reused. */
  credentialCacheMs: Schema.number().default(300000).volatile(),
  /** OpenAI-compatible field carrying streamed reasoning (`reasoning_content`, ...). */
  reasoningField: Schema.string().default('reasoning_content').volatile(),
  /** OpenAI-compatible field carrying the reasoning effort. */
  effortField: Schema.string().default('reasoning_effort').volatile(),
  timeoutMs: Schema.number().default(1800000).volatile(),
  requestTimeoutMs: Schema.number().default(30000).volatile(),
  /**
   * Transparent retries of one generation request after the upstream stream is
   * cut before it produced any delta. Nothing has reached the transcript yet at
   * that point, so a retry cannot duplicate or corrupt content.
   */
  streamRetries: Schema.number().default(1).volatile(),
  /**
   * Keep a step's partial output when the stream is cut after it started. With
   * this off, the adapter reports `OPENCODE_BACKEND` and the harness fails the
   * whole turn (the measured 2026-10-31 `terminated` failure).
   */
  streamCutPreserve: Schema.boolean().default(true).volatile(),
  /**
   * Split transcript-style tags (`<thinking>`, `[tool call …]`, `<invoke …>`)
   * that a route leaks into `delta.content` into real reasoning/tool-call
   * blocks instead of storing them as literal assistant text.
   */
  inlineTags: Schema.boolean().default(true).volatile(),
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  catalogPath: Schema.string().default('').volatile(),
  catalogSyncMs: Schema.number().default(300000).volatile(),
  /**
   * Where the settings tab's last entitlement sweep is kept. Empty follows the
   * catalog rule (profile dir, then `$DSH_HOME/cache`). The sweep costs ~20 s,
   * so it runs on the button and the snapshot is what every later open shows.
   */
  verdictPath: Schema.string().default('').volatile(),
  /**
   * Which plan the account is on. `go` = the OpenCode Go subscription
   * (`opencode-go/*` routes), `zen` = pay-as-you-go (`opencode/*`). The catalog
   * provider id is the plan, so availability needs no per-model request.
   */
  activePlan: Schema.union(PLANS).default('go').volatile(),
  /** Public usage ranking used to order the checklist inside each group. */
  rankingUrl: Schema.string().default('https://opencode.ai/data/index.json').volatile(),
  /** Where the ranking snapshot is cached; empty follows the catalog rule. */
  rankingPath: Schema.string().default('').volatile(),
  /** How long the cached ranking stays fresh before a refresh fetches again (5 days). */
  rankingTtlMs: Schema.number().default(432000000).volatile(),
  /** Where the first-seen route snapshot lives; empty follows the catalog rule. */
  knownModelsPath: Schema.string().default('').volatile(),
  /** How long a newly appeared route keeps priority-0 ordering. */
  newModelDays: Schema.number().default(NEW_MODEL_DAYS).volatile(),
  /**
   * Route allow-list for the prompt model picker. Empty means "every route the
   * active plan offers". A non-empty list hides every other route from
   * `listModels`, which is what the settings tab writes; running sessions are
   * unaffected.
   */
  enabledModels: Schema.array(Schema.string()).default([]).volatile(),
})

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`
}

/** Basic auth header for the local control-plane server (`opencode:<password>`). */
export function authHeader(password) {
  return `Basic ${Buffer.from(`opencode:${password ?? ''}`).toString('base64')}`
}

/** `provider/id` -> backend model ref; `default` maps through the route table. */
export function modelRefFromRoute(route, table, defaultModel) {
  const entry = (table ?? []).find((item) => item.id === route)
  const resolved = route === 'default' ? entry?.opencodeModel || defaultModel || '' : entry?.opencodeModel || route
  if (!resolved) return null
  const slash = resolved.indexOf('/')
  if (slash <= 0) return null
  return { providerID: resolved.slice(0, slash), id: resolved.slice(slash + 1) }
}

/** Stable key for "same backend model + variant". */
export function modelKey(ref, variant) {
  return ref ? `${ref.providerID}/${ref.id}${variant ? `#${variant}` : ''}` : ''
}

/**
 * The caller session's active workspace directory, owned by DSH.
 * Missing services/session are non-fatal: the harness never guesses a project.
 */
export function resolveWorkspaceDirectory(ctx, options) {
  try {
    const id = options?.sessionId
    if (!id) return ''
    return ctx?.sessions?.get?.(id)?.header?.cwd ?? ''
  } catch {
    return ''
  }
}

/** Parse one SSE block (`event:` optional, `data:` concatenated). */
export function parseSseBlock(block) {
  let data = ''
  for (const line of String(block).split(/\r?\n/)) {
    if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * Async iterator over an OpenAI-compatible SSE body.
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortSignal} signal
 */
export async function* chatSseEvents(body, signal) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const match = buffer.match(/\r?\n\r?\n/)
        if (!match) break
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (String(block).includes('data: [DONE]')) return
        const event = parseSseBlock(block)
        if (event) yield event
      }
    }
    const tail = parseSseBlock(buffer)
    if (tail) yield tail
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
  }
}

/**
 * The local OpenCode control-plane endpoint. It supplies catalog, provider
 * metadata, and credentials only; generation never goes through it.
 */
export class ServerManager {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.resolved = null
    this.child = null
    this.state = null
  }

  stateFilePath() {
    return this.config.serviceStatePath.get()
  }

  headers() {
    return { ...attributionHeaders(), authorization: authHeader(this.resolved?.password ?? '') }
  }

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
        `OpenCode control plane unavailable: ${[...reasons, `spawn failed (${detail})`].join('; ')}. ` +
          'Set opencodePath to an absolute executable path, or keep a daemon running.',
      )
    }
  }

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

export function parseBanner(text) {
  const url = String(text ?? '').match(/server listening on (https?:\/\/\S+)/)
  if (!url) return null
  const password = String(text).match(/server password (\S+)/)
  return { url: url[1].replace(/\/+$/, ''), password: password ? password[1] : '' }
}

/** Build the OpenAI-compatible request body from DSH `GenerateOptions`. */
export function buildChatRequest(options, ref, config) {
  const messages = []
  const append = (role, content) => {
    if (content === undefined || content === null || content === '') return
    messages.push({ role, content })
  }

  if (options.system) append('system', options.system)
  for (const message of options.messages ?? []) {
    const text = blocksToText(message.content).trim()
    if (message.role === 'assistant') {
      const toolCalls = (message.content ?? [])
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
          id: String(block.id),
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        }))
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls })
      } else {
        append('assistant', text)
      }
    } else if (message.role === 'tool') {
      append('tool', text)
      const last = messages[messages.length - 1]
      if (last?.role === 'tool') last.tool_call_id = String(message.toolCallId)
    } else if (message.role === 'developer') {
      append('system', text)
    } else {
      append('user', text)
    }
  }

  const body = {
    model: ref.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined) body.stop = options.stop
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== 'off') {
    body[config.effortField.get()] = options.reasoningEffort
  }
  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    body.tool_choice = 'auto'
  }
  return body
}

/** Map OpenAI's final `usage` object onto DSH's disjoint buckets. */
export function usageFromOpenAi(raw) {
  const prompt = Number(raw?.prompt_tokens ?? 0)
  const cached = Number(raw?.prompt_tokens_details?.cached_tokens ?? 0)
  const output = Number(raw?.completion_tokens ?? 0)
  const reasoning = Number(raw?.completion_tokens_details?.reasoning_tokens ?? 0)
  const usage = {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
  if (Number.isFinite(reasoning) && reasoning > 0) usage.reasoningTokens = reasoning
  usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens
  return usage
}

/** Map OpenAI finish reasons onto DSH finish kinds. */
export function finishFromOpenAi(reason) {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'stop' }
  }
}

/** Local control-plane catalog + pure OpenAI-compatible generation. */
export class OpencodeHttpAdapter {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.providerId = options.providerId ?? 'opencode-http-agent'
    this.standDown = false
    this.server = new ServerManager(ctx, config)
    this.backendCache = null
    this.lastWorkspace = ''
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

  warmStart() {
    this.catalog.seed()
    this.catalog.start()
  }

  dispose() {
    this.catalog.stop()
    this.server.dispose()
  }

  announce() {
    try {
      this.ctx?.emit?.('llm/models-updated', this.providerId)
    } catch (error) {
      this.ctx?.logger?.warn?.(`model catalog announcement failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode Go (direct)' }
  }

  providerRetryPolicy() {}
  imageRequestPricing() {}

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

  describe() {
    const version = this.server.resolved?.version
    return version ? `OpenCode Go v${version} (OpenAI-compatible backend)` : 'OpenCode Go (OpenAI-compatible backend)'
  }

  async listModels(provider) {
    const discovered = await this.discover()
    const description = this.describe()
    const enabled = enabledRouteFilter(this.config.enabledModels.get().map((entry) => String(entry)))
    // The prompt picker only offers routes the active plan can use. Availability
    // is decided from the provider id alone (no per-model request), so this is a
    // pure filter and never touches the backend.
    const activePlan = this.config.activePlan.get()
    const allowsPlan = (route) => planOfRoute(route) === activePlan
    if (discovered?.models?.length) {
      this.markKnown(discovered.models.map((model) => String(model.id)))
      const firstSeen = this.readFirstSeen().firstSeen
      const ranking = this.readRanking().byModel
      const now = Date.now()
      const newWithinDays = this.config.newModelDays.get()
      const rows = discovered.models
        // Catalog ids are already `provider/model` (measured: no separate providerID field).
        // A route that just appeared is offered even when the allow-list is set,
        // so a new model is reachable from the prompt without hunting for it. The
        // plan gate still applies, and the window closes after `newModelDays`.
        .filter((model) => {
          const route = String(model.id)
          if (!allowsPlan(route)) return false
          if (enabled === null || enabled.has(route)) return true
          return isNewModel(route, { firstSeen, ranking, now, newWithinDays })
        })
        .map((model) => ({
          provider,
          id: model.id,
          name: model.name,
          description,
          inputModalities: ['text'],
        }))
      // Priority 0 for a route that just appeared, so it shows up at the top of
      // the prompt picker instead of behind 40 ranked models.
      rows.sort((left, right) => {
        const leftNew = isNewModel(left.id, { firstSeen, ranking, now, newWithinDays })
        const rightNew = isNewModel(right.id, { firstSeen, ranking, now, newWithinDays })
        if (leftNew !== rightNew) return leftNew ? -1 : 1
        return String(left.name ?? left.id).localeCompare(String(right.name ?? right.id))
      })
      return [
        { provider, id: 'default', name: 'OpenCode (config default)', description, inputModalities: ['text'] },
        ...rows,
      ]
    }
    if (this.config.autoDiscoverModels.get()) {
      const reason = this.discoveryError?.message ?? 'the server returned no models'
      throw new Error(`OpenCode model catalog unavailable: ${reason}`)
    }
    return this.config.models
      .get()
      .filter((entry) => allowsPlan(String(entry.id)) && (enabled === null || enabled.has(String(entry.id))))
      .map((entry) => ({
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

  /**
   * Resolve the OpenAI-compatible backend root and bearer credential.
   *
   * Priority:
   *   1. explicit `backendBaseUrl` / `apiKey` (or `OPENCODE_API_KEY`)
   *   2. local control plane: `/api/provider/{id}` + active `/api/credential`
   *
   * The result is cached for `credentialCacheMs`; a 401 forces one refresh.
   */
  async resolveBackend(signal, { force = false } = {}) {
    const now = Date.now()
    if (!force && this.backendCache && now - this.backendCache.at < this.config.credentialCacheMs.get()) {
      return this.backendCache.value
    }
    const providerId = this.config.backendProviderId.get()
    let provider = null
    let baseURL = this.config.backendBaseUrl.get()
    if (!baseURL) {
      const payload = await this.server.request('GET', `/api/provider/${encodeURIComponent(providerId)}`, undefined, { signal })
      provider = payload?.data
      baseURL = provider?.settings?.baseURL
      if (!baseURL) throw new Error(`OpenCode provider "${providerId}" exposes no settings.baseURL`)
    }
    let credential = this.config.apiKey.get()
    if (!credential && this.config.apiKeyEnv.get()) credential = process.env[this.config.apiKeyEnv.get()] ?? ''
    if (!credential) credential = await this.activeCredential(provider, signal)
    if (!credential) throw new Error(`no credential for OpenCode provider "${providerId}"`)
    const value = {
      baseURL: String(baseURL).replace(/\/+$/, ''),
      headers: {
        ...attributionHeaders(),
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...(provider?.headers ?? {}),
        authorization: `Bearer ${credential}`,
      },
    }
    this.backendCache = { at: now, value }
    return value
  }

  /**
   * Choose the credential for the backend from the local credential store.
   *
   * Order matters and was measured (2026-10-30): the Go endpoint rejects a
   * revoked `key` credential with 401 while the active web `oauth` token is
   * accepted, so a literal "first active match" sends a dead key. Preference:
   *
   *   1. an active `oauth` entry of this integration (the web login is the
   *      credential the user actually maintains),
   *   2. an active `key` entry,
   *   3. the first active entry of the integration.
   *
   * Optionally pinned by `credentialLabel`. A 401 triggers one refresh, so a
   * rotated credential is picked up without a restart.
   */
  async activeCredential(provider, signal) {
    const payload = await this.server.request('GET', '/api/credential', undefined, { signal })
    const entries = Array.isArray(payload?.data) ? payload.data : []
    const providerId = this.config.backendProviderId.get()
    const integration = provider?.integrationID ?? providerId
    const label = this.config.credentialLabel.get()
    /**
     * The credential store files credentials under `opencode` (the web login and
     * the master keys), while the model route is `opencode-go`. Accept every id
     * that can own the credential so one live credential is never invisible.
     */
    const owners = new Set(
      [integration, providerId, provider?.id, 'opencode-go', 'opencode'].filter(
        (id) => typeof id === 'string' && id.length > 0,
      ),
    )
    let candidates = entries.filter(
      (entry) => entry?.active === true && owners.has(entry.integrationID),
    )
    if (label) {
      const pinned = candidates.filter((entry) => String(entry.label ?? '') === label)
      if (pinned.length > 0) candidates = pinned
    }
    const rank = (entry) => (entry?.value?.type === 'oauth' ? 0 : entry?.value?.type === 'key' ? 1 : 2)
    candidates = candidates.slice().sort((left, right) => rank(left) - rank(right))
    const value = candidates[0]?.value ?? {}
    if (value.type === 'oauth') return value.access ?? ''
    if (value.type === 'key') return value.key ?? ''
    return ''
  }

  /**
   * Persist what the backend already said about a route during real traffic.
   *
   * There is deliberately no probe routine: one request per route per sweep cost
   * 49 requests against a per-request quota. A real turn that the backend refuses
   * (`unavailable`, `deprecated`, 401, 403) is the same evidence for free, and a
   * success clears a stale refusal. Written only when the state changes, so the
   * common path performs no I/O.
   *
   * @param route - `provider/model` catalog id.
   * @param state - `classifyProbe()` result.
   * @returns true when the snapshot changed on disk.
   */
  observe(route, state) {
    const key = String(route ?? '')
    // Only real `provider/model` routes are recorded; `default` is a pseudo-row.
    if (key.length === 0 || !key.includes('/')) return false
    const store = (this.verdictStore ??= createVerdictStore({
      explicit: this.config.verdictPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
    }))
    const snapshot = store.read()
    if (state === 'usable') {
      // Plan availability already says "usable"; drop a stale refusal instead of
      // storing a second source of truth.
      if (snapshot.verdicts[key] === undefined) return false
      delete snapshot.verdicts[key]
    } else {
      if (snapshot.verdicts[key] === state) return false
      snapshot.verdicts[key] = state
    }
    store.write({ verdicts: snapshot.verdicts, measuredAt: new Date().toISOString() })
    return true
  }

  /** Current refusal snapshot (`route -> state`) for the settings tab. */
  verdicts() {
    const store = (this.verdictStore ??= createVerdictStore({
      explicit: this.config.verdictPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
    }))
    return store.read()
  }

  /** Where the first-seen snapshot is kept. */
  knownFile() {
    return resolveCatalogPath({
      explicit: this.config.knownModelsPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
      fileName: 'opencode-known-models.json',
    })
  }

  /** `{ firstSeen: { route: ISO } }`; never performs network I/O. */
  readFirstSeen() {
    if (this.firstSeenValue) return this.firstSeenValue
    const path = this.knownFile()
    let snapshot = { firstSeen: {} }
    if (path) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        snapshot = { firstSeen: raw?.firstSeen && typeof raw.firstSeen === 'object' ? raw.firstSeen : {} }
      } catch {
        /* first run */
      }
    }
    this.firstSeenValue = snapshot
    return snapshot
  }

  /**
   * Record routes seen for the first time.
   *
   * The very first run seeds the whole catalog at the epoch instead of "now", so
   * an existing deployment does not label all 49 routes as new. Only routes that
   * appear later get a real timestamp and thereby priority-0 ordering for
   * `newModelDays`. Plan availability is untouched: a new route from the other
   * plan is still not offered.
   *
   * @param routes - current catalog routes.
   * @returns the routes added by this call.
   */
  markKnown(routes) {
    const snapshot = this.readFirstSeen()
    const path = this.knownFile()
    const firstRun = path ? !existsSync(path) : false
    const stamp = firstRun ? '1970-01-01T00:00:00.000Z' : new Date().toISOString()
    const added = []
    for (const route of routes ?? []) {
      const key = String(route ?? '')
      if (key.length === 0 || snapshot.firstSeen[key] !== undefined) continue
      snapshot.firstSeen[key] = stamp
      if (!firstRun) added.push(key)
    }
    if (added.length > 0 || firstRun) {
      if (path) {
        try {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`)
        } catch {
          /* the snapshot is best effort */
        }
      }
    }
    return added
  }

  /** Where the public usage ranking is cached. */
  rankingFile() {
    return resolveCatalogPath({
      explicit: this.config.rankingPath.get(),
      profileDir: this.ctx?.get?.('profileContext')?.dir,
      dshHome: process.env.DSH_HOME,
      fileName: 'opencode-data-ranking.json',
    })
  }

  /** Cached `{ byModel, updatedAt, fetchedAt }`; never performs network I/O. */
  readRanking() {
    if (this.rankingValue) return this.rankingValue
    const path = this.rankingFile()
    let snapshot = { byModel: {}, updatedAt: null, fetchedAt: 0 }
    if (path) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        snapshot = {
          byModel: raw?.byModel && typeof raw.byModel === 'object' ? raw.byModel : {},
          updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
          fetchedAt: typeof raw?.fetchedAt === 'number' ? raw.fetchedAt : 0,
        }
      } catch {
        /* no cache yet */
      }
    }
    this.rankingValue = snapshot
    return snapshot
  }

  /**
   * Refresh the usage ranking from `opencode.ai/data/index.json`.
   *
   * One GET, unrelated to the model quota; cached for `rankingTtlMs` so the tab
   * can sort without a network call on every open.
   *
   * @param force - fetch even when the cache is still fresh.
   */
  async refreshRanking(force = false) {
    const current = this.readRanking()
    if (!force && current.fetchedAt > 0 && Date.now() - current.fetchedAt < this.config.rankingTtlMs.get()) {
      return current
    }
    const response = await fetch(this.config.rankingUrl.get(), { headers: { accept: 'application/json' }, redirect: 'error' })
    if (!response.ok) throw new Error(`usage ranking fetch failed: HTTP ${response.status}`)
    const parsed = rankingFromDataIndex(await response.json())
    const snapshot = { byModel: parsed.ranking, updatedAt: parsed.updatedAt, fetchedAt: Date.now() }
    this.rankingValue = snapshot
    const path = this.rankingFile()
    if (path) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`)
      } catch {
        /* the cache is best effort */
      }
    }
    return snapshot
  }

  async *stream(options) {
    if (this.standDown) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'ROUTER_STANDDOWN',
            message: 'dsh-opencode-v2-http yielded the OpenCode namespace to a legacy provider (conflictPolicy: stand-down)',
          },
        },
      }
      return
    }

    const config = this.config
    const timeout = AbortSignal.timeout(config.timeoutMs.get())
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    this.lastWorkspace = resolveWorkspaceDirectory(this.ctx, options)

    const ref = modelRefFromRoute(options.model, config.models.get(), config.defaultModel.get())
    if (!ref) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_HTTP_MODEL', message: `unmapped route ${options.model}` } } }
      return
    }
    if (options.reasoningEffort !== undefined) {
      let found = null
      try {
        found = await this.lookupModel(options.model)
      } catch {
        /* discovery unavailable: let the backend decide */
      }
      if (found && !(found.variants ?? []).includes(options.reasoningEffort)) {
        const message = unsupportedEffortMessage(options.provider, options.model, options.reasoningEffort, found.variants ?? [])
        this.ctx?.logger?.warn?.(`opencode-http-agent: ${message}`)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message } } }
        return
      }
    }

    const blocks = new Map()
    const toolCalls = new Map()
    const open = (kind, index) => {
      const key = `${kind}:${index}`
      let block = blocks.get(key)
      if (!block) {
        block = { index, kind, closed: false, text: '', id: '', name: '', arguments: '' }
        blocks.set(key, block)
      }
      return block
    }
    const closeAll = function* () {
      for (const block of [...blocks.values()].sort((left, right) => left.index - right.index)) {
        if (block.closed) continue
        block.closed = true
        yield {
          type: 'block-end',
          index: block.index,
          block: block.kind === 'tool-call'
            ? { type: 'tool-call', id: block.id || `call_${block.index}`, name: block.name, arguments: block.arguments || '{}' }
            : { type: block.kind, text: sanitizeProtocolText(block.text) },
        }
      }
    }
    /**
     * Close every open block after an upstream cut.
     *
     * A tool call whose arguments were cut mid-JSON cannot be repaired reliably,
     * so it is closed with the closest valid prefix of its arguments (or `{}`)
     * instead of being left open or carrying invalid JSON.
     * @returns {object[]} the `block-end` chunks.
     */
    const closeCut = () => {
      const chunks = []
      for (const block of [...blocks.values()].sort((left, right) => left.index - right.index)) {
        if (block.closed) continue
        block.closed = true
        if (block.kind === 'tool-call') {
          const repaired = repairJson(block.arguments) ?? '{}'
          chunks.push({
            type: 'block-end',
            index: block.index,
            block: { type: 'tool-call', id: block.id || `call_${block.index}`, name: block.name, arguments: repaired },
          })
          continue
        }
        chunks.push({
          type: 'block-end',
          index: block.index,
          block: { type: block.kind, text: sanitizeProtocolText(block.text) },
        })
      }
      return chunks
    }
    /** Drop every in-flight block, so a retried attempt starts from nothing. */
    const resetBlocks = () => {
      blocks.clear()
      toolCalls.clear()
    }

    let response = null
    let backend = null
    let usage = null
    let finishReason = null
    let textStarted = false
    let reasoningStarted = false
    let inlineToolSeq = 0
    let emitted = 0
    let router = null

    /**
     * Write one routed part of the model output as block chunks.
     * @param {object} part - `{ kind: 'text'|'reasoning', text }` or `{ kind: 'tool-call', id, name, arguments }`.
     * @returns {Generator<object>} the chunks for that part.
     */
    const emitPart = function* (part) {
      if (part.kind === 'tool-call') {
        const block = open('tool-call', INLINE_TOOL_INDEX_BASE + inlineToolSeq * 2)
        inlineToolSeq += 1
        block.id = part.id ?? ''
        block.name = part.name ?? ''
        block.arguments = part.arguments ?? '{}'
        emitted += 1
        yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: block.id || `call_${block.index}`,
          ...(block.name ? { name: block.name } : {}),
          argumentsDelta: block.arguments,
        }
        return
      }
      if (typeof part.text !== 'string' || part.text.length === 0) return
      if (part.kind === 'reasoning') {
        const block = open('reasoning', REASONING_INDEX)
        if (!reasoningStarted) {
          reasoningStarted = true
          yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
        }
        block.text += part.text
        emitted += 1
        yield { type: 'reasoning-delta', index: block.index, text: part.text }
        return
      }
      const block = open('text', TEXT_INDEX)
      if (!textStarted) {
        textStarted = true
        yield { type: 'block-start', index: block.index, blockType: 'text' }
      }
      block.text += part.text
      emitted += 1
      yield { type: 'text-delta', index: block.index, text: part.text }
    }

    const maxStreamRetries = Math.max(0, Math.trunc(config.streamRetries.get()) || 0)
    const preserveCut = config.streamCutPreserve.get()

    try {
      backend = await this.resolveBackend(signal)
      const body = buildChatRequest(options, ref, config)
      const headers = sessionHeaders(backend.headers, options, config)
      const send = () => fetch(joinUrl(backend.baseURL, config.chatPath.get()), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
      response = await send()
      if (response.status === 401) {
        backend = await this.resolveBackend(signal, { force: true })
        response = await send()
      }

      let retried = 0
      for (let attempt = 0; ; attempt += 1) {
        if (attempt > 0) {
          response = await send()
          if (response.status === 401) {
            backend = await this.resolveBackend(signal, { force: true })
            response = await send()
          }
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          // Free entitlement evidence: the backend just answered for this route, so
          // a refusal is recorded without spending another request on a probe.
          const observed = classifyProbe(response.status, text)
          if (String(options.model ?? '').includes('/')) this.observe(options.model, observed)
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                code: response.status === 401 || response.status === 403 ? 'OPENCODE_BACKEND_AUTH' : 'OPENCODE_BACKEND_HTTP',
                message: `OpenCode backend HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
              },
            },
          }
          return
        }
        if (!response.body) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_BACKEND_EMPTY', message: 'backend returned no response body' } } }
          return
        }
        // A served route clears any stale refusal recorded for it.
        if (String(options.model ?? '').includes('/')) this.observe(options.model, 'usable')

        usage = null
        finishReason = null
        textStarted = false
        reasoningStarted = false
        inlineToolSeq = 0
        emitted = 0
        resetBlocks()
        router = config.inlineTags.get() === false
          ? null
          : createInlineTagRouter({
            toolNames: new Set(
              (options.tools ?? [])
                .map((tool) => tool?.name)
                .filter((toolName) => typeof toolName === 'string' && toolName.length > 0),
            ),
          })
        bootBeacon('stream', { router: router !== null, tools: (options.tools ?? []).length })

        try {
          for await (const chunk of chatSseEvents(response.body, signal)) {
            if (chunk?.usage) usage = usageFromOpenAi(chunk.usage)
            const choice = chunk?.choices?.[0]
            if (!choice) continue
            const delta = choice.delta ?? {}

            const rawReasoning = delta[config.reasoningField.get()] ?? delta.reasoning ?? delta.reasoning_text
            const reasoningText = typeof rawReasoning === 'string' ? sanitizeProtocolText(rawReasoning) : rawReasoning
            if (typeof reasoningText === 'string' && reasoningText.length > 0) {
              const block = open('reasoning', REASONING_INDEX)
              if (!reasoningStarted) {
                reasoningStarted = true
                yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
              }
              block.text += reasoningText
              emitted += 1
              yield { type: 'reasoning-delta', index: block.index, text: reasoningText }
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (router) {
                const routed = router.push(delta.content)
                routingTrace(options, routed, delta.content, router.stats)
                for (const part of routed) yield* emitPart(part)
              } else {
                const block = open('text', TEXT_INDEX)
                if (!textStarted) {
                  textStarted = true
                  yield { type: 'block-start', index: block.index, blockType: 'text' }
                }
                block.text += delta.content
                emitted += 1
                yield { type: 'text-delta', index: block.index, text: delta.content }
              }
            }

            for (const call of delta.tool_calls ?? []) {
              const ordinal = Number(call.index ?? 0)
              let entry = toolCalls.get(ordinal)
              if (!entry) {
                entry = { block: open('tool-call', TOOL_INDEX_BASE + ordinal * 2), started: false }
                toolCalls.set(ordinal, entry)
              }
              const block = entry.block
              if (call.id) block.id = String(call.id)
              if (call.function?.name) block.name = String(call.function.name)
              const args = call.function?.arguments
              if (!entry.started && (block.id || block.name)) {
                entry.started = true
                const initialArgs = typeof args === 'string' ? args : ''
                block.arguments += initialArgs
                emitted += 1
                yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
                yield {
                  type: 'tool-call-delta',
                  index: block.index,
                  id: block.id || `call_${block.index}`,
                  ...(block.name ? { name: block.name } : {}),
                  argumentsDelta: initialArgs,
                }
              } else if (typeof args === 'string' && args.length > 0) {
                block.arguments += args
                emitted += 1
                yield {
                  type: 'tool-call-delta',
                  index: block.index,
                  id: block.id || `call_${block.index}`,
                  argumentsDelta: args,
                }
              }
            }

            if (choice.finish_reason) finishReason = choice.finish_reason
          }

          if (router) for (const part of router.flush()) yield* emitPart(part)
          for (const chunk of closeAll()) yield chunk
          if (usage) yield { type: 'usage', usage }
          if (options.signal?.aborted) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } } }
          } else if (timeout.aborted) {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_TIMEOUT', message: `OpenCode backend exceeded timeoutMs=${config.timeoutMs.get()}` } } }
          } else {
            yield { type: 'finish', reason: finishFromOpenAi(finishReason) }
          }
          return
        } catch (error) {
          // The caller's own verdicts keep their meaning across a cut.
          if (options.signal?.aborted) {
            for (const chunk of closeAll()) yield chunk
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } } }
            return
          }
          if (timeout.aborted) {
            for (const chunk of closeAll()) yield chunk
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_TIMEOUT', message: `OpenCode backend exceeded timeoutMs=${config.timeoutMs.get()}` } } }
            return
          }
          const detail = errorText(error)
          const transient = isTransientStreamError(error)
          // 1. Nothing reached the model yet: retry the request transparently. A
          //    silent retry is invisible to the transcript, so it cannot corrupt it.
          if (transient && emitted === 0 && retried < maxStreamRetries) {
            retried += 1
            this.ctx?.logger?.warn?.(
              `opencode-http-agent: upstream stream cut before any output (${detail}); retry ${retried}/${maxStreamRetries}`,
            )
            continue
          }
          // 2. Partial output: keep it. A hard error here kills a turn that had
          //    already produced usable work (measured: 3 of the last 6 sessions
          //    ended on a bare `terminated` with the whole step discarded).
          if (preserveCut && emitted > 0) {
            if (router) for (const part of router.flush()) yield* emitPart(part)
            for (const chunk of closeCut()) yield chunk
            if (usage) yield { type: 'usage', usage }
            this.ctx?.logger?.warn?.(
              `opencode-http-agent: upstream stream cut after ${emitted} delta(s) (${detail}); partial output preserved and closed as a stop`,
            )
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          // 3. Nothing to preserve: keep the honest error verdict.
          for (const chunk of closeAll()) yield chunk
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: { code: 'OPENCODE_BACKEND', message: detail },
            },
          }
          return
        }
      }
    } catch (error) {
      for (const chunk of closeAll()) yield chunk
      yield {
        type: 'finish',
        reason: options.signal?.aborted
          ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } }
          : {
              kind: 'error',
              failure: {
                code: 'OPENCODE_BACKEND',
                message: error instanceof Error ? error.message : String(error),
              },
            },
      }
    }
  }
}

/**
 * Error codes and messages that mean "the connection dropped", not "the request
 * was wrong".
 *
 * Measured 2026-10-31: an upstream cut surfaces from `fetch` as
 * `TypeError: terminated` (undici), and from the socket layer as `ECONNRESET` /
 * `UND_ERR_SOCKET`. These are the only errors a retry can plausibly fix.
 */
const TRANSIENT_STREAM_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
])

/**
 * Whether a stream failure is a transport cut rather than a request verdict.
 * @param {unknown} error - the thrown value.
 * @returns {boolean} whether a retry or a partial preserve is appropriate.
 */
export function isTransientStreamError(error) {
  if (!error) return false
  const code = String(error.code ?? error.cause?.code ?? '')
  if (TRANSIENT_STREAM_CODES.has(code)) return true
  const message = String(error.message ?? error)
  return /terminated|socket hang up|other side closed|premature close|stream closed/i.test(message)
}

/**
 * The balanced closers `text` needs, or null when it closes more than it opens.
 * @param {string} text - a JSON fragment.
 * @returns {string | null} `"` plus `}`/`]` in reverse open order.
 */
function balancedClosers(text) {
  let inString = false
  let escape = false
  const stack = []
  for (const ch of text) {
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (inString) {
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null
      stack.pop()
    }
  }
  let out = inString ? '"' : ''
  for (let index = stack.length - 1; index >= 0; index -= 1) out += stack[index] === '{' ? '}' : ']'
  return out
}

/**
 * Best-effort JSON for tool arguments that were cut mid-flight.
 *
 * It truncates the fragment at a token boundary and appends the closers the
 * fragment needs, keeping the values that were already complete. `null` means no
 * prefix repaired, and the caller must fall back to `{}`.
 * @param {string} text - the accumulated (incomplete) arguments.
 * @returns {string | null} valid JSON text.
 */
export function repairJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  try {
    JSON.parse(raw)
    return raw
  } catch {
    /* fall through to the repair ladder */
  }
  if (raw[0] !== '{' && raw[0] !== '[') return null
  const floor = Math.max(0, raw.length - 400)
  for (let end = raw.length; end > floor; end -= 1) {
    const head = raw.slice(0, end).replace(/[\s,:]+$/, '')
    if (!head) continue
    const closers = balancedClosers(head)
    if (closers === null) continue
    const candidate = head + closers
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      /* keep shortening */
    }
  }
  return null
}

/**
 * Optional routing trace, for when the transcript still shows protocol notation.
 *
 * Off by default: set `OPENCODE_V2_ROUTING_DEBUG=1` and the adapter appends one
 * JSONL line per content delta to `/tmp/opencode-v2-routing.jsonl`, recording the
 * raw delta and the parts it produced. It answers one question that no test can:
 * did the notation arrive as `content` at all, and what did the router decide?
 * Failures here must never affect the stream.
 *
 * @param {object} options - the `GenerateOptions` of the request.
 * @param {object[]} routed - parts returned by the router.
 * @param {string} delta - the raw content delta.
 * @param {object} stats - router counters.
 * @returns {void}
 */
function routingTrace(options, routed, delta, stats) {
  if (process.env.OPENCODE_V2_ROUTING_DEBUG === '0') return
  try {
    appendFileSync(
      '/tmp/opencode-v2-routing.jsonl',
      `${JSON.stringify({
        at: new Date().toISOString(),
        model: options?.model,
        delta: delta.slice(0, 400),
        parts: routed.map((part) => (part.kind === 'tool-call' ? `tool-call:${part.name}` : part.kind)),
        stats,
      })}\n`,
    )
  } catch {
    /* tracing must never break a stream */
  }
}

/**
 * Append-only beacon proving which plugin code a process actually loaded.
 *
 * Written at stream start: if the beacon says `0.7.5` while the transcript still
 * shows protocol notation, the notation is not produced by this adapter. If the
 * beacon is missing, the plugin is not the code on disk.
 *
 * @param {string} event - the beacon event name.
 * @param {object} [detail] - extra fields.
 * @returns {void}
 */
function bootBeacon(event, detail = {}) {
  if (process.env.OPENCODE_V2_BEACON === '0') return
  try {
    const file = '/tmp/opencode-v2-boot.jsonl'
    const size = existsSync(file) ? statSync(file).size : 0
    if (size > 1_000_000) return
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, version: VERSION, event, ...detail })}\n`)
  } catch {
    /* a beacon must never affect the plugin */
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
  return 'OpenCode backend failed'
}

/**
 * Build the prompt-picker allow-list.
 *
 * An empty list means "no restriction" (every served route is selectable), which
 * keeps an unconfigured install behaving exactly as before. Hiding a route only
 * changes what the picker offers: a session that already selected it keeps
 * running, which is the measured 2026-10-30 requirement ("display only").
 *
 * @param routes - `provider/id` entries from the settings tab.
 * @returns the matching set, or `null` when nothing is restricted.
 */
export function enabledRouteFilter(routes) {
  const list = (routes ?? []).filter((route) => typeof route === 'string' && route.trim().length > 0)
  return list.length === 0 ? null : new Set(list.map((route) => route.trim()))
}

/**
 * Classify a one-shot probe result for the entitlement sweep.
 *
 * The Go backend answers a usable model with 200 and an unusable one with 400
 * `Model is unavailable.`, 410 `... has been deprecated`, or 403 (no
 * subscription). Classification is the backend's own message, never a guess.
 *
 * @param status - HTTP status of the probe.
 * @param message - `error.message` when the probe failed.
 * @returns the measured state of that route.
 */
export function classifyProbe(status, message) {
  const text = String(message ?? '')
  if (status >= 200 && status < 300) return 'usable'
  if (/deprecated/i.test(text)) return 'deprecated'
  if (/unavailable/i.test(text)) return 'unavailable'
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  return 'error'
}

/**
 * Add the conversation-identity header the Go backend requires.
 *
 * Measured 2026-10-30 against `https://opencode.ai/inference/go/openai/v1`:
 * a request without `x-opencode-session` is rejected with HTTP 400
 * `{"type":"error","error":{"type":"MissingSessionID", ...}}`; with the header
 * the same request is served. The OpenCode console documents this for Go
 * ("Send a stable session ID in `x-opencode-session` for each conversation") and
 * lists DeepSeek Harness under known problematic clients for exactly this gap.
 *
 * A dispatch without a DSH session id (catalog or title probes, direct adapter
 * callers) still needs a stable value, otherwise the backend answers 400 before
 * it ever looks at the credential.
 */
export function sessionHeaders(headers, options, config) {
  const name = config.sessionHeader.get()
  if (!name) return headers
  const session = options?.sessionId !== undefined && options?.sessionId !== null && options.sessionId !== ''
    ? String(options.sessionId)
    : config.sessionFallback.get()
  if (!session) return headers
  return { ...headers, [name]: session }
}

/** Legacy OpenCode `tokens` mapper, kept for batch-worker consumers/tests. */
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

/** Sum two legacy usage records bucket by bucket. */
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

/**
 * Plugin body: register the native `opencode-http-agent` route, own its
 * catalog/server lifecycle, and reconcile runtime conflicts.
 */
export function apply(ctx, config) {
  const providerId = 'opencode-http-agent'
  const adapter = new OpencodeHttpAdapter(ctx, config, { providerId })

  const policy = () => normalizeConflictPolicy(
    typeof config?.conflictPolicy?.get === 'function'
      ? config.conflictPolicy.get()
      : config?.conflictPolicy,
  )
  const log = (message) => {
    try {
      ctx?.logger?.warn?.(message)
    } catch {
      /* logging is advisory */
    }
  }

  let registration = null
  let directory = null
  let warmed = false
  let busy = false
  let released = false
  let lastCode = ''

  const commit = () => {
    busy = true
    try {
      registration = ctx.llm.registerAdapter([providerId], adapter)
      adapter.standDown = false
    } finally {
      busy = false
    }
    if (!directory) {
      try {
        directory = ctx.llm.registerConfigurableProviders([
          { provider: providerId, displayName: 'OpenCode Go (direct)', settingsNs: name, settingsPath: [] },
        ])
      } catch (error) {
        log(`dsh-opencode-v2-http: could not advertise the configurable provider: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (!warmed) {
      warmed = true
      try {
        adapter.warmStart()
      } catch (error) {
        log(`dsh-opencode-v2-http: catalog warm start failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const reconcile = () => {
    if (released || busy) return
    const decision = decideRouterConflict(detectRouterConflicts(ctx?.llm, providerId), policy())
    if (decision.code !== lastCode) {
      lastCode = decision.code
      if (decision.warning) log(decision.warning)
    }
    if (decision.action === 'serve') {
      if (!registration) commit()
      return
    }
    if (registration) {
      const release = registration
      registration = null
      adapter.standDown = true
      try {
        release()
      } catch {
        /* the host may have released it first */
      }
    } else {
      adapter.standDown = true
    }
  }

  reconcile()
  if (typeof ctx?.on === 'function') ctx.on('llm/adapters-updated', () => reconcile())

  const dispose = () => {
    if (released) return
    released = true
    try {
      directory?.()
    } catch {
      /* already released */
    }
    directory = null
    try {
      registration?.()
    } catch {
      /* already released */
    }
    registration = null
    adapter.dispose()
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => dispose(), 'dsh-opencode-v2-http: dispose adapter and owned server')
  }
  registerModelSettingsRoutes(ctx, adapter, config, log)
  return dispose
}

/**
 * Settings namespace of this plugin row.
 *
 * The loader derives a row's settings namespace from its config row id, which the
 * bundle patch pins to `dsh-opencode-v2-http` (the module name). Keeping the
 * derivation in one place makes a rename a single edit.
 *
 * @param config - the row config (unused today; kept for a future explicit override).
 * @returns the namespace `ctx.settings` expects.
 */
export function settingsNs(config) {
  const explicit = config?.settingsNs
  if (explicit && typeof explicit.get === 'function') {
    const value = explicit.get()
    if (typeof value === 'string' && value.length > 0) return value
  }
  return 'dsh-opencode-v2-http'
}

/**
 * Serve the settings tab's operations over the local connection.
 *
 * `model-settings` returns the catalog plus the current allow-list;
 * `model-settings/measure` runs the entitlement sweep; `model-settings/apply`
 * persists a new allow-list. The sweep runs only on an explicit measure request —
 * never during a conversation — so the prompt path never pays for it.
 *
 * Registration is optional: a host without `ctx.connection.fetch` simply has no
 * settings tab, and every adapter behaviour stays intact.
 *
 * @param ctx - plugin context.
 * @param adapter - the mounted HTTP adapter.
 * @param config - the row config carrying `enabledModels`.
 * @param log - warning sink.
 * @returns true when the routes were registered.
 */
export function registerModelSettingsRoutes(ctx, adapter, config, log = () => {}) {
  const register = ctx?.connection?.fetch?.register
  if (typeof register !== 'function') return false
  const respond = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const readJson = async (request) => {
    try {
      const text = await request.text()
      return text ? JSON.parse(text) : {}
    } catch {
      return null
    }
  }

  /** Annotate and order the served catalog for the settings checklist. */
  const describeModels = async () => {
    const discovered = await adapter.discover().catch(() => null)
    const rows = (discovered?.models ?? []).map((model) => ({ route: String(model.id), name: model.name ?? String(model.id) }))
    const ranking = adapter.readRanking()
    const snapshot = adapter.verdicts()
    adapter.markKnown(rows.map((row) => row.route))
    const models = orderModels(rows, {
      activePlan: config.activePlan?.get?.() ?? 'go',
      verdicts: snapshot.verdicts,
      ranking: rankingForRoutes(rows.map((row) => row.route), ranking.byModel),
      firstSeen: adapter.readFirstSeen().firstSeen,
      newWithinDays: config.newModelDays?.get?.() ?? NEW_MODEL_DAYS,
    })
    return { models, verdicts: snapshot.verdicts, observedAt: snapshot.measuredAt, ranking }
  }

  const visibleRoutes = async () =>
    adapter
      .listModels()
      .then((list) => list.map((model) => model.id).filter((id) => id !== 'default'))
      .catch(() => [])

  const routes = {
    'model-settings': async () => {
      const state = await describeModels()
      return respond({
        activePlan: config.activePlan?.get?.() ?? 'go',
        plans: PLANS,
        enabled: config.enabledModels?.get?.() ?? [],
        models: state.models,
        visible: await visibleRoutes(),
        verdicts: state.verdicts,
        observedAt: state.observedAt,
        ranking: {
          updatedAt: state.ranking.updatedAt,
          fetchedAt: state.ranking.fetchedAt,
          covered: Object.keys(state.ranking.byModel ?? {}).length,
        },
      })
    },
    'model-settings/ranking/refresh': async () => {
      const snapshot = await adapter.refreshRanking(true)
      return respond({
        updatedAt: snapshot.updatedAt,
        fetchedAt: snapshot.fetchedAt,
        covered: Object.keys(snapshot.byModel ?? {}).length,
      })
    },
    'model-settings/apply': async (request) => {
      const payload = await readJson(request)
      if (payload === null) return respond({ error: 'expected JSON' }, 400)
      const wantsEnabled = Array.isArray(payload.enabled)
      const wantsPlan = typeof payload.activePlan === 'string'
      if (!wantsEnabled && !wantsPlan) {
        return respond({ error: 'expected { enabled?: string[], activePlan?: "go"|"zen" }' }, 400)
      }
      const settings = ctx?.settings
      if (typeof settings?.update !== 'function') {
        return respond({ error: 'this host exposes no settings service; set enabledModels / activePlan in the profile patch' }, 409)
      }
      const patch = {}
      if (wantsEnabled) {
        patch.enabledModels = payload.enabled
          .filter((route) => typeof route === 'string' && route.trim().length > 0)
          .map((route) => route.trim())
      }
      if (wantsPlan) {
        if (!PLANS.includes(payload.activePlan)) {
          return respond({ error: `activePlan must be one of ${PLANS.join(', ')}` }, 400)
        }
        patch.activePlan = payload.activePlan
      }
      await settings.update(settingsNs(config), patch)
      const state = await describeModels()
      return respond({
        activePlan: config.activePlan?.get?.() ?? 'go',
        enabled: config.enabledModels?.get?.() ?? [],
        models: state.models,
        visible: await visibleRoutes(),
      })
    },
  }

  for (const [suffix, handler] of Object.entries(routes)) {
    try {
      ctx.effect(
        () =>
          register({
            path: `/api/local/opencode-v2/${suffix}`,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
              try {
                return await handler(request)
              } catch (error) {
                log(`dsh-opencode-v2-http: ${suffix} failed: ${error instanceof Error ? error.message : String(error)}`)
                return respond({ error: String(error?.message ?? error) }, 500)
              }
            },
          }),
        `dsh-opencode-v2-http: ${suffix}`,
      )
    } catch (error) {
      log(`dsh-opencode-v2-http: could not register ${suffix}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return true
}
