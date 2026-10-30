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
import { readFileSync } from 'node:fs'

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
import {
  decideRouterConflict,
  detectRouterConflicts,
  normalizeConflictPolicy,
} from './conflicts.js'

/** Plugin name; the cordis row uses the `@nolit/dsh-opencode-v2/http` specifier. */
export const name = 'dsh-opencode-v2-http'

/** The llm registry, subprocess (local control-plane/server), and live sessions (cwd). */
export const inject = ['llm', 'subprocess', 'sessions']

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
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  catalogPath: Schema.string().default('').volatile(),
  catalogSyncMs: Schema.number().default(300000).volatile(),
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

  async activeCredential(provider, signal) {
    const payload = await this.server.request('GET', '/api/credential', undefined, { signal })
    const entries = Array.isArray(payload?.data) ? payload.data : []
    const integration = provider?.integrationID ?? this.config.backendProviderId.get()
    const active = entries.find(
      (entry) =>
        entry?.active === true &&
        (entry.integrationID === integration || entry.integrationID === this.config.backendProviderId.get()),
    )
    const value = active?.value ?? {}
    if (value.type === 'key') return value.key ?? ''
    if (value.type === 'oauth') return value.access ?? ''
    return ''
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
            : { type: block.kind, text: block.text },
        }
      }
    }

    let response = null
    let backend = null
    try {
      backend = await this.resolveBackend(signal)
      const body = buildChatRequest(options, ref, config)
      const send = () => fetch(joinUrl(backend.baseURL, config.chatPath.get()), {
        method: 'POST',
        headers: backend.headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
      response = await send()
      if (response.status === 401) {
        backend = await this.resolveBackend(signal, { force: true })
        response = await send()
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
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

      let usage = null
      let finishReason = null
      let textStarted = false
      let reasoningStarted = false

      for await (const chunk of chatSseEvents(response.body, signal)) {
        if (chunk?.usage) usage = usageFromOpenAi(chunk.usage)
        const choice = chunk?.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}

        const reasoningText = delta[config.reasoningField.get()] ?? delta.reasoning ?? delta.reasoning_text
        if (typeof reasoningText === 'string' && reasoningText.length > 0) {
          const block = open('reasoning', REASONING_INDEX)
          if (!reasoningStarted) {
            reasoningStarted = true
            yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
          }
          block.text += reasoningText
          yield { type: 'reasoning-delta', index: block.index, text: reasoningText }
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          const block = open('text', TEXT_INDEX)
          if (!textStarted) {
            textStarted = true
            yield { type: 'block-start', index: block.index, blockType: 'text' }
          }
          block.text += delta.content
          yield { type: 'text-delta', index: block.index, text: delta.content }
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

      for (const chunk of closeAll()) yield chunk
      if (usage) yield { type: 'usage', usage }
      if (options.signal?.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'request cancelled by the caller' } } }
      } else if (timeout.aborted) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_TIMEOUT', message: `OpenCode backend exceeded timeoutMs=${config.timeoutMs.get()}` } } }
      } else {
        yield { type: 'finish', reason: finishFromOpenAi(finishReason) }
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
  return dispose
}
