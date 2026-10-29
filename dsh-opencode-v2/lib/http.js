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

import { buildPrompt, blocksToText, sessionTitleText } from './provider.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  modelsFromApiPayload,
  reasoningEffortsFromVariants,
} from './shared.js'

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
  /** Route id used when the DSH model id is the literal `default`. */
  defaultModel: Schema.string().default('opencode/beam-free').volatile(),
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

  /** Absolute path of the CLI daemon's state file. */
  stateFilePath() {
    const configured = this.config.serviceStatePath.get()
    if (configured) return configured
    const home = process.env.HOME ?? ''
    return `${home}/.local/state/opencode/service.json`
  }

  /** Headers for one request to the resolved server. */
  headers() {
    return { ...attributionHeaders(), authorization: authHeader(this.resolved?.password ?? '') }
  }

  /** Fetch `path` and parse JSON; throws on a non-2xx answer. */
  async request(method, path, body, { signal, timeoutMs } = {}) {
    const endpoint = await this.ensure()
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
      this.resolved = { url: baseUrl.replace(/\/+$/, ''), password, owned: false }
      return this.resolved
    }
    if (this.config.attachToDaemon.get()) {
      const attached = this.attach()
      if (attached) {
        this.resolved = attached
        return attached
      }
    }
    if (!this.config.spawnServer.get()) {
      throw new Error('no OpenCode server: baseUrl is empty, the daemon is not alive, and spawnServer is disabled')
    }
    this.resolved = await this.spawn()
    return this.resolved
  }

  /** Read the CLI daemon state file and verify it is alive. */
  attach() {
    try {
      const raw = readFileSync(this.stateFilePath(), 'utf8')
      if (!raw) return null
      const state = JSON.parse(raw)
      if (!state?.url || !state?.password) return null
      if (state.pid) {
        try {
          process.kill(state.pid, 0)
        } catch {
          return null
        }
      }
      this.state = state
      return { url: String(state.url).replace(/\/+$/, ''), password: String(state.password), owned: false }
    } catch {
      return null
    }
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
    const info = await fetch(joinUrl(banner.url, '/api/info'), {
      headers: { ...attributionHeaders(), authorization: authHeader(banner.password) },
    }).then((response) => (response.ok ? response.json() : null))
    if (!info?.version) {
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
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.server = new ServerManager(ctx, config)
    this.sessions = new Map()
    this.discovered = null
    this.discovering = null
  }

  dispose() {
    this.server.dispose()
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode v2 (HTTP)' }
  }

  providerRetryPolicy() {}

  imageRequestPricing() {}

  /** Discover the route catalog from `/api/model` (single-flight + cached). */
  async discover() {
    if (!this.config.autoDiscoverModels.get()) return null
    const cacheMs = this.config.discoveryCacheMs.get()
    if (this.discovered && Date.now() - this.discovered.at < cacheMs) return this.discovered.result
    if (!this.discovering) {
      this.discovering = this.discoverOnce().finally(() => {
        this.discovering = undefined
      })
    }
    return this.discovering
  }

  async discoverOnce() {
    try {
      const payload = await this.server.request('GET', '/api/model')
      const result = modelsFromApiPayload(payload)
      if (result) this.discovered = { at: Date.now(), result }
      return result
    } catch {
      return null
    }
  }

  async listModels(provider) {
    const discovered = await this.discover()
    if (discovered?.models?.length) {
      return [
        { provider, id: 'default', name: 'OpenCode (config default)', description: 'OpenCode via HTTP API', inputModalities: ['text'] },
        ...discovered.models.map((model) => ({
          provider,
          id: model.id,
          name: model.name,
          description: 'OpenCode via HTTP API',
          inputModalities: ['text'],
        })),
      ]
    }
    return this.config.models.get().map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name || `OpenCode ${entry.id}`,
      description: 'OpenCode via HTTP API',
      inputModalities: ['text'],
    }))
  }

  async resolveModel(provider, model) {
    const found = await this.lookupModel(model)
    const efforts = found?.variants?.length ? reasoningEffortsFromVariants(found.variants) : []
    return {
      provider,
      id: model,
      name: found?.name ?? `OpenCode ${model}`,
      description: 'OpenCode via HTTP API',
      inputModalities: ['text'],
      context: { contextWindow: found?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: found?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(efforts.length ? { reasoning: { efforts } } : {}),
    }
  }

  async lookupModel(model) {
    const discovered = await this.discover()
    if (!discovered?.models?.length) return null
    const route = model === 'default' ? this.config.defaultModel.get() : model
    return (
      discovered.models.find((entry) => entry.id === model) ??
      discovered.models.find((entry) => entry.id.endsWith(`/${model}`)) ??
      null
    )
  }

  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: (options) => this.stream(options) }
  }

  /** Resolve or create the OpenCode session that backs one DSH session. */
  async sessionFor(key, ref, variant, directory) {
    const existing = key ? this.sessions.get(key) : null
    const wanted = modelKey(ref, variant)
    if (existing) {
      // A server restart (or an external delete) invalidates our mapping.
      if (existing.sent) {
        try {
          await this.server.request('GET', `/api/session/${existing.sessionID}`)
        } catch (error) {
          if (error.status === 404) this.sessions.delete(key)
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
        } catch (error) {
          if (error.status === 404) {
            this.sessions.delete(key)
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
    if (key) this.sessions.set(key, session)
    return session
  }

  /**
   * Stream one generation. Text/reasoning arrive as deltas; `session.step.ended`
   * supplies exact tokens; permission prompts are answered by config.
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
              usage = usageFromTokens(tokens)
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
                message: String(event.data?.error ?? event.data?.message ?? 'opencode execution failed'),
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

      if (!terminal) {
        terminal = timeout.aborted
          ? { kind: 'error', failure: { code: 'OPENCODE_TIMEOUT', message: `opencode exceeded timeoutMs=${config.timeoutMs.get()}` } }
          : { kind: 'error', failure: { code: 'OPENCODE_HTTP_FAILED', message: 'event stream ended before a terminal execution event' } }
      }
      if (!usage) {
        try {
          const info = await this.server.request('GET', `/api/session/${session.sessionID}`)
          if (info?.data?.tokens) {
            usage = usageFromTokens(info.data.tokens)
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
        reason: {
          kind: 'error',
          failure: {
            code: signal.aborted ? 'OPENCODE_INTERRUPTED' : 'OPENCODE_HTTP',
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
  const adapter = new OpencodeHttpAdapter(ctx, config)
  const registration = ctx.llm.registerAdapter(['opencode-http-agent'], adapter)
  ctx.llm.registerConfigurableProviders([
    {
      provider: 'opencode-http-agent',
      displayName: 'OpenCode v2 (HTTP)',
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
  return () => adapter.dispose()
}
