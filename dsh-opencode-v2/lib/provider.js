/**
 * Batch-worker backend for OpenCode v2.2.0.
 *
 * This module is NOT a conversation route. Chat, streaming, and model serving
 * are owned by `lib/http.js` (`opencode-http-agent`); the CLI adapter here is a
 * one-shot worker that a subagent/batch tool drives and whose artifacts the host
 * collects. It therefore registers no LLM adapter and exports no `apply`.
 *
 * Behaviour kept from the earlier route implementation:
 *   - v2 argv (no --attach/--pure, `--thinking` on) via shared.js.
 *   - reasoning events stream as `reasoning-delta` on their own block index.
 *   - route context/variants come from `/api/model`; `-m provider/model#variant`
 *     selects the reasoning level on the wire.
 *   - `usage` comes from `opencode session export <sid>`; when that fails the
 *     chunk is omitted rather than estimated.
 *   - `exportTimeoutMs` bounds the post-run usage fetch.
 *
 * The adapter is duck-typed against the documented LlmAdapter surface, so this
 * module carries no runtime import of @deepseek-ai/dsh-llm.
 */
import Schema from '@deepseek-ai/schemastery'

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  JsonRunParser,
  buildRunArgv,
  fetchUsage,
  forwardedEnv,
  modelsFromApiPayload,
  modelsFromCliOutput,
  reasoningEffortsFromVariants,
  sendPrompt,
  stripUnsupportedFlags,
  unsupportedEffortMessage,
  withVariant,
} from './shared.js'
import { CatalogLifecycle, CatalogStore, resolveCatalogPath } from './catalog-cache.js'

/** Row id kept for the worker package's identity and settings namespace. */
export const name = 'dsh-opencode-v2-provider'

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_SERVER_PASSWORD',
]

/** Schemastery schema: defaults live here; cordis.yml and GUI edits are validated against it. */
export const Config = Schema.object({
  opencodePath: Schema.string().default('opencode').volatile(),
  auto: Schema.boolean().default(true).volatile(),
  // Legacy @quonaro 0.1.x keys: accepted so old rows load, never emitted.
  attach: Schema.string().default('').volatile(),
  pure: Schema.boolean().default(false).volatile(),
  thinking: Schema.boolean().default(true).volatile(),
  cwd: Schema.string().default('').volatile(),
  timeoutMs: Schema.number().default(1800000).volatile(),
  stderrMaxBytes: Schema.number().default(65536).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
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
  localSessionTitles: Schema.boolean().default(true).volatile(),
  autoDiscoverModels: Schema.boolean().default(true).volatile(),
  discoveryTimeoutMs: Schema.number().default(60000).volatile(),
  discoveryCacheMs: Schema.number().default(300000).volatile(),
  /** Snapshot file holding the last good catalog; empty resolves under the active profile. */
  catalogPath: Schema.string().default('').volatile(),
  /** Background catalog sync period in ms; 0 keeps refreshes demand-driven only. */
  catalogSyncMs: Schema.number().default(300000).volatile(),
  /** Budget for the post-run `session export` usage fetch; 0 disables it. */
  exportTimeoutMs: Schema.number().default(60000).volatile(),
})

const ROLE_LABEL = {
  system: 'system',
  developer: 'developer',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool result',
}

/** Project one message's blocks into transcript text. */
export function blocksToText(blocks) {
  return (blocks ?? [])
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'reasoning':
          return `<thinking>\n${block.text}\n</thinking>`
        case 'tool-call':
          return `[tool call ${block.name} #${block.id}]: ${block.arguments}`
        case 'image':
          return '[image]'
        case 'file':
          return '[file]'
        case 'tool-addition':
          return `[tool enabled: ${block.toolName}]`
        case 'tool-removal':
          return `[tool disabled: ${block.toolName}]`
        default:
          return `[${block.type}]`
      }
    })
    .join('\n')
}

/** Flatten one generation request into the prompt handed to `opencode run`. */
export function buildPrompt(options, brief) {
  const parts = [brief, '', '<transcript>']
  if (options.system) parts.push('## system', options.system, '')
  for (const message of options.messages) {
    parts.push(`## ${ROLE_LABEL[message.role] ?? message.role}`, blocksToText(message.content), '')
  }
  parts.push('</transcript>')
  if (options.tools?.length) {
    const names = options.tools
      .map((tool) => tool.name)
      .slice(0, 12)
      .join(', ')
    parts.push(
      '',
      `[note: the caller declared ${options.tools.length} of its own tools (${names}${options.tools.length > 12 ? ', …' : ''}) — you cannot invoke them; complete the work with your own capabilities.]`,
    )
  }
  return parts.join('\n')
}

/**
 * Map an advertised route id to its `-m` value.
 * A route missing from the table passes through verbatim; the literal
 * `default` maps to `''` only when the table's `default` entry says so.
 */
export function resolveOpencodeModel(routeId, table) {
  const entry = (table ?? []).find((m) => m.id === routeId)
  if (entry) return entry.opencodeModel
  return routeId === 'default' ? '' : routeId
}

/**
 * Prefix the host wraps session-title requests in (`dsh-session-title-llm`
 * `frameMessages`): the actual human messages sit inside a JSON payload.
 */
const TITLE_FRAME_PREFIX = 'Generate the session title from this JSON array of human messages:'

/**
 * Source text for a cheap local session title: the last user message, with the
 * host's title-request JSON framing unwrapped to the first framed human message.
 */
export function sessionTitleText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const raw = blocksToText(message.content)
    const at = raw.indexOf(TITLE_FRAME_PREFIX)
    if (at === -1) return raw.replace(/\s+/g, ' ').trim() || 'OpenCode session'
    try {
      const items = JSON.parse(raw.slice(at + TITLE_FRAME_PREFIX.length))
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item) continue
          const text = (
            typeof item.text === 'string' ? item.text : Array.isArray(item.content) ? blocksToText(item.content) : ''
          )
            .replace(/\s+/g, ' ')
            .trim()
          if (text) return text
        }
      }
    } catch {
      /* fall through */
    }
    return 'OpenCode session'
  }
  return 'OpenCode session'
}

/** Bytes of `opencode serve` banner kept before giving up on a usable port line. */
const SERVE_BANNER_MAX_BYTES = 65536

/**
 * Extract the ready facts from the `opencode serve` banner.
 *
 * Measured v2.2.0 stdout:
 *   server listening on http://127.0.0.1:42111
 *   server password <token>
 *
 * @param {string} text - bytes received so far
 * @returns {{port: number, password: string} | null}
 */
export function parseServeBanner(text) {
  const port = String(text ?? '').match(/server listening on https?:\/\/[^:\s]+:(\d+)/)
  if (!port) return null
  const password = String(text).match(/server password (\S+)/)
  return { port: Number(port[1]), password: password ? password[1] : '' }
}

/**
 * Wait for the `opencode serve` banner and capture its port and password.
 *
 * `handle.stdout` exists only when the child was spawned with `stdout: 'pipe'`
 * (`dsh-subprocess` types.d.ts:159); a collect-mode stdout (`{ maxBytes }`)
 * exposes `collected.stdout` and no stream, so reading it would always return
 * null. Returns null on timeout, shutdown, or an unusable banner.
 *
 * @param {{stdout: AsyncIterable<Uint8Array> | undefined}} handle
 * @param {number} timeout - readiness budget in milliseconds
 * @param {AbortSignal} [signal] - caller cancellation
 * @returns {Promise<{port: number, password: string} | null>}
 */
async function waitForServeReady(handle, timeout, signal) {
  const stdout = handle.stdout
  if (!stdout) return null
  const decoder = new TextDecoder()
  let buffer = ''
  const timer = AbortSignal.timeout(timeout)
  const stop = signal ? AbortSignal.any([signal, timer]) : timer
  const onAbort = () => {
    try {
      handle.stdout?.destroy?.()
    } catch {
      /* already closed */
    }
  }
  stop.addEventListener('abort', onAbort, { once: true })
  const aborted = new Promise((resolve) => {
    if (stop.aborted) resolve({ done: true })
    else stop.addEventListener('abort', () => resolve({ done: true }), { once: true })
  })
  try {
    const iterator = stdout[Symbol.asyncIterator]()
    for (;;) {
      const pending = iterator.next()
      // A stream destroyed by onAbort would otherwise reject this promise
      // after the race below has already returned.
      pending.catch(() => {})
      const step = await Promise.race([pending, aborted])
      if (step.done) return stop.aborted ? null : parseServeBanner(buffer)
      buffer += decoder.decode(step.value, { stream: true })
      const ready = parseServeBanner(buffer)
      if (ready) return ready
      if (buffer.length > SERVE_BANNER_MAX_BYTES) return null
    }
  } catch {
    // A destroyed stream (timeout/abort) rejects the iteration; both mean "not ready".
    return null
  } finally {
    stop.removeEventListener('abort', onAbort)
  }
}

/**
 * GET one JSON document from the local opencode server.
 * Uses global fetch (Node 18+); basic auth with the printed password.
 */
async function fetchJsonOverHttp(url, password, signal) {
  const headers = password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {}
  const response = await fetch(url, { headers, signal })
  if (!response.ok) return null
  return response.json()
}

/** Discover the model catalog by listing `opencode models`. */
export async function discoverModels(ctx, opts) {
  const env = forwardedEnv(opts.envNames)
  const executable = await ctx.subprocess.resolveExecutable(opts.opencodePath, env, opts.signal)
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const handle = ctx.subprocess.spawn({
    argv: [executable, 'models'],
    cwd: opts.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4194304 },
      stderr: { maxBytes: opts.stderrMaxBytes ?? 65536 },
    },
    graceMs: 5000,
    signal,
    env,
  })
  try {
    if ((await handle.done).exitCode !== 0) return null
    return modelsFromCliOutput(handle.collected.stdout?.readFrom(0).text ?? '')
  } catch {
    return null
  } finally {
    handle.terminate()
    await handle.waitForExit(AbortSignal.timeout(6000)).catch(() => false)
  }
}

/**
 * Discover the model catalog **with per-model context limits** via
 * `opencode serve` -> `GET /api/model`.
 *
 * `opencode models` lists ids only, and a route with no context window makes
 * `compaction-basic` throw ("no context capacity …"). The serve API returns
 * `limit.context` / `limit.output` per model, which is what the adapter must
 * publish as `context.contextWindow` and `defaultMaxTokens`.
 *
 * Best-effort: returns null on any failure so the caller can fall back.
 *
 * @param {*} ctx
 * @param {{
 *   opencodePath: string,
 *   envNames: readonly string[],
 *   cwd?: string,
 *   timeoutMs: number,
 *   stderrMaxBytes?: number,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{models: object[]} | null>}
 */
export async function discoverModelsViaServe(ctx, opts) {
  const env = forwardedEnv(opts.envNames)
  const executable = await ctx.subprocess.resolveExecutable(opts.opencodePath, env, opts.signal)
  const env_ = { ...env, OPENCODE_SERVER_PASSWORD: env.OPENCODE_SERVER_PASSWORD ?? '' }
  // `opencode serve` needs a private port; let the OS pick one, learn it from stdout.
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const handle = ctx.subprocess.spawn({
    argv: [executable, 'serve', '--port', '0'],
    cwd: opts.cwd,
    // `stdout` MUST be 'pipe': the ready banner is read from the live stream, and
    // a collect-mode stdout exposes no stream at all (see waitForServeReady).
    stdio: {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: { maxBytes: opts.stderrMaxBytes ?? 65536 },
    },
    graceMs: 5000,
    signal,
    env: env_,
  })
  try {
    const ready = await waitForServeReady(handle, Math.min(opts.timeoutMs, 20000), opts.signal)
    if (!ready) return null
    const payload = await fetchJsonOverHttp(
      `http://127.0.0.1:${ready.port}/api/model`,
      ready.password,
      AbortSignal.timeout(Math.min(opts.timeoutMs, 15000)),
    )
    return modelsFromApiPayload(payload)
  } catch {
    return null
  } finally {
    handle.terminate()
    await handle.waitForExit?.(AbortSignal.timeout(6000)).catch(() => false)
  }
}

/** Block index for reasoning. Text owns index 0; reasoning must differ. */
export const REASONING_INDEX = 1

/**
 * Turn an ordered parser event list into block lifecycle chunks.
 *
 * Reasoning and text each own a block index (text=0, reasoning=1). An index is
 * opened on first use and closed by `closeBlocks()` once the part family ends,
 * so reasoning-then-text yields start(1)…end(1) then start(0)…end(0).
 *
 * @param {readonly {kind: 'text'|'reasoning', partId: string, delta: string}[]} events
 * @param {Map<number, {type: string, text: string, closed: boolean}>} state
 *   shared across calls when streaming incrementally; fresh for a one-shot call
 * @returns {object[]} start/delta chunks only (no block-end)
 */
export function eventsToChunks(events, state = new Map()) {
  const chunks = []
  for (const event of events) {
    const index = event.kind === 'reasoning' ? REASONING_INDEX : 0
    const blockType = event.kind === 'reasoning' ? 'reasoning' : 'text'
    const existing = state.get(index)
    if (existing?.closed) throw new Error(`opencode stream reopened closed block index ${index}`)
    if (!existing) state.set(index, { type: blockType, text: '', closed: false })
    const block = state.get(index)
    if (block.type !== blockType) throw new Error(`block index ${index} reused for ${blockType}`)
    if (!existing) chunks.push({ type: 'block-start', index, blockType })
    block.text += event.delta
    chunks.push({ type: event.kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text: event.delta })
  }
  return chunks
}

/**
 * Close every open block index in first-seen order. Idempotent.
 * @param {Map<number, {type: string, text: string, closed: boolean}>} state
 */
export function closeBlocks(state) {
  const chunks = []
  for (const [index, block] of state) {
    if (block.closed) continue
    block.closed = true
    chunks.push({ type: 'block-end', index, block: { type: block.type, text: block.text } })
  }
  return chunks
}

/** One-shot convenience: full lifecycle for a finished event list. */
export function eventsToFullChunks(events) {
  const state = new Map()
  return [...eventsToChunks(events, state), ...closeBlocks(state)]
}

/** The provider-wire adapter. */
export class OpencodeLlmAdapter {
  /**
   * @param {*} ctx Host context (llm registry, subprocess, events).
   * @param {*} config Validated plugin configuration.
   * @param {{ providerId?: string, catalogFileName?: string }} [options]
   *   Route name announced on catalog changes and the snapshot file name.
   */
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.providerId = options.providerId ?? 'opencode-agent'
    this.catalogStore = new CatalogStore(
      resolveCatalogPath({
        explicit: config.catalogPath.get(),
        profileDir: ctx?.get?.('profileContext')?.dir,
        dshHome: process.env.DSH_HOME,
        fileName: options.catalogFileName ?? 'opencode-models.json',
      }),
    )
    this.catalog = new CatalogLifecycle({
      probe: (signal) => this.discoverOnce(signal),
      store: this.catalogStore,
      cacheMs: () => this.config.discoveryCacheMs.get(),
      syncMs: () => this.config.catalogSyncMs.get(),
      onChanged: () => this.announce(),
      warn: (message) => ctx?.logger?.warn?.(message),
    })
  }

  providerInfo(provider) {
    return { id: provider, name: 'OpenCode (CLI)' }
  }

  providerRetryPolicy() {}

  imageRequestPricing() {}

  /**
   * Load the durable catalog and start the background sync.
   *
   * Runs after registration so the first Web catalog read already answers from
   * memory; the probe that follows replaces the snapshot without blocking boot.
   */
  warmStart() {
    this.catalog.seed()
    this.catalog.start()
  }

  /** Stop the background sync timer. */
  stop() {
    this.catalog.stop()
  }

  /** Tell connected clients that this provider's model list changed. */
  announce() {
    try {
      this.ctx?.emit?.('llm/models-updated', this.providerId)
    } catch (error) {
      this.ctx?.logger?.warn?.(`model catalog announcement failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * List the route catalog without blocking on a live probe when a snapshot or a
   * previous result exists. Stale reads revalidate in the background.
   *
   * The host resolves **every** advertised model (`buildModelCatalog` calls
   * `resolveModelInfo` per route), so concurrent callers share one probe through
   * the lifecycle's single-flight guard; without it a 46-route catalog starts 46
   * `opencode serve` children.
   */
  async discover(signal) {
    if (!this.config.autoDiscoverModels.get()) return null
    return this.catalog.read(signal)
  }

  /** One uncached catalog probe: `serve` -> /api/model, then the CLI listing. */
  async discoverOnce(signal) {
    // A silent fallback is indistinguishable from "this model has no levels": the
    // CLI listing carries ids only, so every level and context window is lost.
    const warnFallback = (reason) => {
      this.ctx?.logger?.warn?.(
        `opencode-agent: serve discovery unavailable (${reason}); falling back to the CLI listing,`
        + ' which advertises no reasoning levels and a conservative context window',
      )
    }
    // 1) `serve` -> /api/model carries per-model limit.context (needed for compaction)
    // and the route's reasoning variants.
    try {
      const viaServe = await discoverModelsViaServe(this.ctx, {
        opencodePath: this.config.opencodePath.get(),
        envNames: this.config.forwardEnv.get(),
        cwd: this.config.cwd.get() || process.cwd(),
        timeoutMs: this.config.discoveryTimeoutMs.get(),
        stderrMaxBytes: this.config.stderrMaxBytes.get(),
        signal,
      })
      if (viaServe?.models?.length) return viaServe
      warnFallback('serve discovery returned no models')
    } catch (error) {
      warnFallback(messageOf(error))
    }
    try {
      return await discoverModels(this.ctx, {
        opencodePath: this.config.opencodePath.get(),
        envNames: this.config.forwardEnv.get(),
        cwd: this.config.cwd.get() || process.cwd(),
        timeoutMs: this.config.discoveryTimeoutMs.get(),
        stderrMaxBytes: this.config.stderrMaxBytes.get(),
        signal,
      })
    } catch {
      return null
    }
  }

  async listModels(provider) {
    const discovered = await this.discover()
    if (discovered && discovered.models.length > 0) {
      return [
        {
          provider,
          id: 'default',
          name: 'OpenCode (config default)',
          description: 'OpenCode agent, spawned headless per generation',
          inputModalities: ['text'],
        },
        ...discovered.models.map((m) => ({
          provider,
          id: m.id,
          name: m.name,
          description: 'OpenCode agent, spawned headless per generation',
          inputModalities: ['text'],
        })),
      ]
    }
    return this.config.models.get().map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name || `OpenCode ${entry.id}`,
      description: 'OpenCode agent, spawned headless per generation',
      inputModalities: ['text'],
    }))
  }

  /**
   * Resolve one exact route: context capacity, output cap, and the route's
   * reasoning levels.
   *
   * `context.contextWindow` is mandatory in practice: `compaction-basic` throws
   * `no context capacity for <provider>/<model>` when a resolved model omits it,
   * which aborts the turn as soon as the session needs compaction (seen on a
   * fresh section right after selecting an opencode model).
   *
   * `reasoning` is what the prompt's thinking selector reads: the host builds
   * the model catalog from this exact result and offers no levels when it is
   * absent. Levels are the route's OpenCode variants, selected on the wire with
   * `-m provider/model#<variant>`; `defaultEffort` stays absent so OpenCode's own
   * default variant applies until the user picks one.
   *
   * Values come from `/api/model` `limit.context` / `limit.output` / `variants`;
   * a route we have never seen falls back to DEFAULT_CONTEXT_WINDOW rather than
   * omitting it, and advertises no levels rather than inventing them.
   */
  async resolveModel(provider, model, signal) {
    const found = await this.lookupModel(model, signal)
    const efforts = found?.variants?.length ? reasoningEffortsFromVariants(found.variants) : []
    return {
      provider,
      id: model,
      name: found?.name ?? `OpenCode ${model}`,
      description: 'OpenCode agent, spawned headless per generation',
      inputModalities: ['text'],
      context: { contextWindow: found?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: found?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(efforts.length ? { reasoning: { efforts } } : {}),
    }
  }

  /**
   * Find one discovered entry by `provider/model`, `model`, or the `default`
   * pseudo-route. Returns null when unknown or discovery is disabled.
   */
  async lookupModel(model, signal) {
    if (model === 'default') {
      const configured = this.config.models.get().find((entry) => entry.id === 'default')
      const opencodeModel = configured?.opencodeModel || ''
      if (!opencodeModel) return null
      return this.lookupModel(opencodeModel, signal)
    }
    const discovered = await this.discover()
    if (!discovered?.models?.length) return null
    return (
      discovered.models.find((entry) => entry.id === model) ??
      discovered.models.find((entry) => entry.id.endsWith(`/${model}`)) ??
      null
    )
  }

  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) }
  }

  async *stream(options) {
    if (options.purpose === 'session-title' && this.config.localSessionTitles.get()) {
      const text = sessionTitleText(options.messages).slice(0, 80)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    // A level reaches `-m …#<variant>` only when discovery advertised it for
    // this exact route. A stale or direct selection would otherwise fail inside
    // OpenCode as an opaque `provider.no-route`; reject it before spawning.
    if (options.reasoningEffort !== undefined) {
      const found = await this.lookupModel(options.model, options.signal)
      if (found && !(found.variants ?? []).includes(options.reasoningEffort)) {
        const message = unsupportedEffortMessage(
          options.provider,
          options.model,
          options.reasoningEffort,
          found.variants ?? [],
        )
        this.ctx?.logger?.warn?.(`opencode-agent: ${message}`)
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message } } }
        return
      }
    }

    const config = this.config
    let env, executable, handle, timeout, prompt, parser, carry, settled, promptDelivered
    try {
      env = forwardedEnv(config.forwardEnv.get())
      executable = await this.ctx.subprocess.resolveExecutable(config.opencodePath.get(), env, options.signal)
      timeout = AbortSignal.timeout(config.timeoutMs.get())
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      prompt = buildPrompt(options, config.brief.get())
      const argv = [
        executable,
        ...buildRunArgv({
          model: withVariant(
            resolveOpencodeModel(options.model, config.models.get()),
            options.reasoningEffort,
          ),
          auto: config.auto.get(),
          thinking: config.thinking.get(),
          format: 'json',
          extraArgs: stripUnsupportedFlags(config.extraArgs.get()),
        }),
      ]
      handle = this.ctx.subprocess.spawn({
        argv,
        cwd: config.cwd.get() || process.cwd(),
        // The prompt goes to stdin, never argv: a flattened transcript exceeds
        // the 128 KiB single-argument limit and used to fail with spawn E2BIG.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: config.stderrMaxBytes.get() } },
        graceMs: 10000,
        signal,
        env,
      })
      // Attach the settlement handler IMMEDIATELY: `handle.done` can reject
      // (spawn failure, kill), and we must consume stdout first. An unhandled
      // rejection here would be turned into `process.exit(1)` by the host's
      // fail-loud installer, so it is converted to a value before any await.
      settled = handle.done.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      )
      // Deliver the prompt on stdin. A pipe-less fake/host still leaves the
      // rejection consumed above; the failure is reported at the end.
      promptDelivered = sendPrompt(handle, prompt)
      parser = new JsonRunParser()
      carry = { buffer: '' }
    } catch (error) {
      // Spawn/resolve failure: never crash the host.
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_SPAWN', message: messageOf(error) } } }
      return
    }

    // Per-chunk event lists are flattened into ONE ordered delta sequence, so
    // a block index is opened and closed exactly once (a per-chunk
    // eventsToChunks() call would re-open index 0 on every stdout chunk).
    const blockState = new Map()
    const streamChunks = (events) => eventsToChunks(events, blockState)
    try {
      const stdout = handle.stdout
      const decoder = new TextDecoder()
      if (stdout) {
        for await (const chunk of stdout) {
          for (const streamChunk of streamChunks(parser.feed(decoder.decode(chunk, { stream: true }), carry))) {
            yield streamChunk
          }
        }
      }
      const tail = parser.feed(decoder.decode(), carry)
      for (const streamChunk of streamChunks(tail)) yield streamChunk
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'OPENCODE_STREAM', message: messageOf(error) } } }
      return
    }

    const end = await settled
    if (!end.ok) {
      // Spawn/guard failure surfaced through `done`: a normal error finish,
      // never a thrown exception.
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'OPENCODE_SPAWN', message: messageOf(end.error) },
        },
      }
      return
    }
    const outcome = end.value

    // Flush any unterminated trailing line; `finish()` returns a new event
    // only when the snapshots changed, so these deltas are strictly new.
    const before = parser.events.length
    const remainder = parser.finish(carry)
    for (const streamChunk of streamChunks(remainder.events.slice(before))) yield streamChunk
    for (const streamChunk of closeBlocks(blockState)) yield streamChunk

    // Authoritative usage, or nothing at all.
    if (remainder.sessionId && (config.exportTimeoutMs?.get?.() ?? 0) > 0) {
      const usage = await fetchUsage({
        ctx: this.ctx,
        opencodePath: config.opencodePath.get(),
        sessionId: remainder.sessionId,
        env,
        cwd: config.cwd.get() || process.cwd(),
        timeoutMs: config.exportTimeoutMs.get(),
      })
      if (usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            totalTokens: usage.totalTokens,
          },
        }
      }
    }

    if (!promptDelivered) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'OPENCODE_SPAWN', message: 'prompt could not be delivered: no stdin pipe' },
        },
      }
    } else if (timeout.aborted) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'OPENCODE_TIMEOUT',
            message: `opencode exceeded timeoutMs=${config.timeoutMs.get()} and was terminated`,
          },
        },
      }
    } else if (outcome.exitCode !== 0 || remainder.errors.length > 0) {
      const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
      const detail = remainder.errors.length ? remainder.errors.join('; ') : tailOf(stderr, 400)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'OPENCODE_EXIT',
            message: `opencode exited ${outcome.exitCode ?? `signal ${outcome.signal}`}${detail ? ` — ${detail}` : ''}`,
          },
        },
      }
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function tailOf(text, max) {
  const clean = String(text ?? '').trim()
  return clean.length > max ? clean.slice(-max) : clean
}
